"""
main.py — StarVision Backend (FastAPI)
Digital twin of a Russian CubeSat constellation.
"""

import logging
import math
import os
import time
from collections import deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Lock
from typing import Deque, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, Query, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

load_dotenv(Path(__file__).resolve().with_name(".env"))

from satellites import (
    get_all_satellites, get_satellite_by_id,
    is_operational,
)
from orbital import (
    propagate_all, propagate_orbit_path,
    get_orbital_elements, predict_collisions, optimize_plane_distribution,
)
from ai_assistant import ask_starai
from celestrak import (
    get_tle_by_source, invalidate_cache, fetch_celestrak_tle, get_cache_status,
)

# ── Application ─────────────────────────────────────────────────────
# Default to local dev origins only. Production hosts MUST be configured
# explicitly via the CORS_ORIGINS env var; we never ship a public IP in
# the codebase because rotating it would require a code change and any
# accidental DNS hijack toward that address could exfiltrate cookies
# (allow_credentials=True below).
_DEFAULT_CORS_ORIGINS = "http://localhost:3000,http://localhost:5173"
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv("CORS_ORIGINS", _DEFAULT_CORS_ORIGINS).split(",")
    if o.strip()
]

app = FastAPI(
    title="StarVision API",
    description="Digital twin API for Russian CubeSat constellation",
    version="1.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _warm_celestrak_cache() -> None:
    """Fire-and-forget CelesTrak prefetch so the very first user click on
    "CelesTrak" finds the cache already populated, instead of waiting
    ~10 s for the cold round-trip. Failure is logged and ignored — the
    endpoint still works via embedded fallback.
    """
    import asyncio as _asyncio

    async def _bg():
        try:
            await fetch_celestrak_tle()
        except Exception:
            logging.getLogger(__name__).exception("CelesTrak warm-up failed")

    _asyncio.create_task(_bg())


# ── Request models ──────────────────────────────────────────────────
# Hard caps protect the LLM-backed /api/starai/chat endpoint from
# accidental or malicious oversize payloads. Without these limits a
# single client could pump multi-megabyte messages, drive up provider
# bills and stall workers; Pydantic rejects the request before it
# reaches the AI layer.
MAX_CHAT_MESSAGE_LEN = 4000
MAX_CHAT_CONTENT_LEN = 4000
MAX_CHAT_HISTORY_ITEMS = 30


class ChatMessage(BaseModel):
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str = Field(..., min_length=1, max_length=MAX_CHAT_CONTENT_LEN)


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=MAX_CHAT_MESSAGE_LEN)
    history: List[ChatMessage] = Field(default_factory=list, max_length=MAX_CHAT_HISTORY_ITEMS)
    lang: str = Field(default="ru", pattern="^(ru|en)$")


# ── Rate limiter (in-memory, per-IP, fixed window) ─────────────────
# Lightweight defence so a single client cannot fan-out chat requests
# faster than humans do. The bound is intentionally generous; abusive
# bursts hit the AI provider's own rate limits anyway. Implemented in
# stdlib to avoid pulling another dep just for one endpoint.
CHAT_RATE_LIMIT_PER_MIN = int(os.getenv("CHAT_RATE_LIMIT_PER_MIN", "20"))
CHAT_RATE_WINDOW_SEC = 60.0
_chat_rate_buckets: Dict[str, Deque[float]] = {}
_chat_rate_lock = Lock()


def _client_ip(req: Request) -> str:
    """Best-effort client identifier. Trusts X-Forwarded-For only when a
    reverse proxy is explicitly declared, otherwise the socket peer is
    the safest default."""
    if os.getenv("TRUST_FORWARDED_FOR") == "1":
        fwd = req.headers.get("x-forwarded-for")
        if fwd:
            return fwd.split(",")[0].strip()
    if req.client and req.client.host:
        return req.client.host
    return "unknown"


def _check_chat_rate_limit(req: Request) -> None:
    if CHAT_RATE_LIMIT_PER_MIN <= 0:
        return
    ip = _client_ip(req)
    now = time.monotonic()
    with _chat_rate_lock:
        bucket = _chat_rate_buckets.setdefault(ip, deque())
        cutoff = now - CHAT_RATE_WINDOW_SEC
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if len(bucket) >= CHAT_RATE_LIMIT_PER_MIN:
            retry_after = max(1, int(CHAT_RATE_WINDOW_SEC - (now - bucket[0])))
            raise HTTPException(
                status_code=429,
                detail="rate_limited",
                headers={"Retry-After": str(retry_after)},
            )
        bucket.append(now)


# ── Timestamp parsing with sanity bounds ───────────────────────────
# SGP4 happily propagates centuries away from the TLE epoch but the
# results are physically meaningless and the computation is unbounded.
# Reject anything farther than ±1 year from now so a client request
# cannot turn into a CPU-bound denial of service.
_TIMESTAMP_MAX_DELTA = timedelta(days=365)


def _parse_timestamp(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid timestamp format") from exc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    if abs(dt - now) > _TIMESTAMP_MAX_DELTA:
        raise HTTPException(status_code=400, detail="timestamp out of supported range (±1 year)")
    return dt


# ── Helper: TLE override ──────────────────────────────────────────
async def _get_tle_override(source: str) -> tuple:
    """Return (override_dict, meta) for the given source.

    * source="embedded": (None, meta) — orbital.py uses the built-in TLE.
    * source="celestrak": (dict, meta) — fetched from CelesTrak; if the
      network is down, override is None and meta.fallback=True so the
      caller can surface the degradation.
    """
    if source != "celestrak":
        return None, {
            "requested_source": "embedded",
            "effective_source": "embedded",
            "fallback": False,
            "error": None,
            **get_cache_status(),
        }
    try:
        override = await fetch_celestrak_tle()
    except Exception:
        # Keep full traceback in the server log; don't leak it into
        # any value that could flow back to a client.
        logging.getLogger(__name__).exception("CelesTrak override failed")
        override = None
    status = get_cache_status()
    if not override:
        return None, {
            "requested_source": "celestrak",
            "effective_source": "embedded_fallback",
            "fallback": True,
            # `last_fetch_error` is an opaque, client-safe code set by
            # celestrak.fetch_celestrak_tle (ERR_TIMEOUT, ERR_NETWORK, …).
            "error": status.get("last_fetch_error") or "upstream_unavailable",
            **status,
        }
    return override, {
        "requested_source": "celestrak",
        "effective_source": "celestrak",
        "fallback": False,
        "error": None,
        **status,
    }


# ── Helper: operational filter on propagate_all output ─────────────
# RUSSIAN_CUBESATS is module-level immutable, so the operational set is
# stable for the lifetime of the process; rebuilding it on every
# /positions and /links call (60+ times per minute under polling) wastes
# work for no reason.
_OPERATIONAL_NORADS_CACHE: Optional[set] = None


def _operational_norads() -> set:
    global _OPERATIONAL_NORADS_CACHE
    if _OPERATIONAL_NORADS_CACHE is None:
        _OPERATIONAL_NORADS_CACHE = {
            s["norad_id"] for s in get_all_satellites() if s["operational"]
        }
    return _OPERATIONAL_NORADS_CACHE


def _filter_operational(positions: list) -> list:
    """Guard against any archival satellite slipping into the position
    stream. propagate_all already filters, but we double-check here so
    an upstream regression cannot silently leak stale orbits.
    """
    allowed = _operational_norads()
    return [p for p in positions if p["norad_id"] in allowed]


# ── Endpoints: Satellites ───────────────────────────────────────────
@app.get("/")
async def root():
    return {
        "project": "StarVision",
        "version": "1.2.0",
        "description": "Цифровой двойник группировки российских кубсатов",
    }


@app.get("/api/satellites")
async def list_satellites():
    """List all satellites with metadata. Every item carries an
    `operational` flag — clients must use it to decide whether to
    render/count/propagate a spacecraft.
    """
    sats = get_all_satellites()
    return {
        "satellites": sats,
        "count": len(sats),
        "operational_count": sum(1 for s in sats if s["operational"]),
        "archive_count": sum(1 for s in sats if not s["operational"]),
    }


@app.get("/api/satellites/{norad_id}")
async def get_satellite(norad_id: int):
    """Information about a specific satellite."""
    sat = get_satellite_by_id(norad_id)
    if not sat:
        raise HTTPException(status_code=404, detail="Satellite not found")
    return {
        "norad_id": sat.norad_id,
        "name": sat.name,
        "constellation": sat.constellation,
        "purpose": sat.purpose,
        "mass_kg": sat.mass_kg,
        "form_factor": sat.form_factor,
        "launch_date": sat.launch_date,
        "status": sat.status,
        "operational": is_operational(sat.status),
        "archive_date": sat.archive_date or None,
        "description": sat.description,
    }


@app.get("/api/tle")
async def get_tle(source: str = Query(default="embedded", pattern="^(embedded|celestrak)$")):
    """TLE data for client-side SGP4 propagation.
    Always returns a `meta` block describing the actual source, cache
    age, and any upstream error — clients must surface this to users.
    """
    payload = await get_tle_by_source(source)
    return {
        "tle_data": payload["tle_data"],
        "source": payload["meta"]["effective_source"],
        "meta": payload["meta"],
    }


@app.post("/api/tle/refresh")
async def refresh_tle():
    """Force refresh TLE cache from CelesTrak. Returns the same
    contract as GET /api/tle so the client does not have to branch.
    """
    invalidate_cache()
    payload = await get_tle_by_source("celestrak")
    return {
        "tle_data": payload["tle_data"],
        "source": payload["meta"]["effective_source"],
        "meta": payload["meta"],
        "refreshed": True,
    }


@app.get("/api/tle/status")
async def tle_status():
    """Expose the live CelesTrak cache state (age, ttl, last error)."""
    return get_cache_status()


@app.get("/api/health")
async def health():
    """Lightweight liveness probe. Reports backend status + TLE cache
    health so the frontend can drive the real "ONLINE / DEGRADED / OFFLINE"
    status indicator instead of a hard-coded light.
    """
    cache = get_cache_status()
    degraded = False
    reasons: list[str] = []
    # A stale cache with a recorded error means live data is broken.
    if cache["last_fetch_error"] and not cache["last_fetch_ok"]:
        degraded = True
        reasons.append("celestrak_unreachable")
    if cache["stale"]:
        reasons.append("cache_stale")
    status = "degraded" if degraded else "ok"
    sats = get_all_satellites()
    operational = sum(1 for s in sats if s["operational"])
    return {
        "status": status,
        "reasons": reasons,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "tle_cache": cache,
        "catalog": {
            "total": len(sats),
            "operational": operational,
            "archival": len(sats) - operational,
        },
    }


# ── Endpoints: Orbital mechanics ────────────────────────────────────
@app.get("/api/positions")
async def get_positions(
    timestamp: Optional[str] = None,
    source: str = Query(default="embedded", pattern="^(embedded|celestrak)$"),
):
    """
    Current positions of operational satellites (ECI + geo).
    Archival (deorbited/inactive) spacecraft are never included.
    ?timestamp=2026-03-29T12:00:00Z — for a specific moment.
    ?source=embedded|celestrak — TLE data source.
    """
    dt = _parse_timestamp(timestamp)
    tle_override, meta = await _get_tle_override(source)
    positions = _filter_operational(propagate_all(dt, tle_override=tle_override))
    return {
        "positions": positions,
        "timestamp": (dt or datetime.now(timezone.utc)).isoformat(),
        "source": meta["effective_source"],
        "meta": meta,
    }


@app.get("/api/orbit/{norad_id}")
async def get_orbit_path(
    norad_id: int,
    steps: int = Query(default=120, ge=10, le=500),
    step_sec: float = Query(default=60.0, ge=10, le=600),
    source: str = Query(default="embedded", pattern="^(embedded|celestrak)$"),
):
    """Orbital track for visualization.
    Returns 409 for archival satellites — their stale TLE would yield
    meaningless trajectories. Clients should hide the "focus" action for
    non-operational spacecraft.
    """
    sat = get_satellite_by_id(norad_id)
    if not sat:
        raise HTTPException(status_code=404, detail="Satellite not found")
    if not is_operational(sat.status):
        raise HTTPException(
            status_code=409,
            detail=f"Satellite {norad_id} is archival ({sat.status}); orbit unavailable",
        )
    tle_override, meta = await _get_tle_override(source)
    path = propagate_orbit_path(sat, datetime.now(timezone.utc), steps, step_sec, tle_override=tle_override)
    return {
        "norad_id": norad_id,
        "name": sat.name,
        "path": path,
        "steps": steps,
        "source": meta["effective_source"],
        "meta": meta,
    }


@app.get("/api/orbits")
async def get_all_orbit_paths(
    steps: int = Query(default=120, ge=10, le=500),
    step_sec: float = Query(default=60.0, ge=10, le=600),
    source: str = Query(default="embedded", pattern="^(embedded|celestrak)$"),
):
    """Batch orbital tracks for every operational satellite.

    Replaces N individual /api/orbit/{id} round-trips with one call, which
    cuts the wall-clock cost of switching to the live (CelesTrak) source
    from N×latency to a single shared TLE-resolve + propagation pass.
    """
    tle_override, meta = await _get_tle_override(source)
    now = datetime.now(timezone.utc)
    paths: dict[int, list] = {}
    names: dict[int, str] = {}
    for sat in get_all_satellites():
        if not sat["operational"]:
            continue
        sat_info = get_satellite_by_id(sat["norad_id"])
        if not sat_info or not sat_info.tle_line1 or not sat_info.tle_line2:
            continue
        path = propagate_orbit_path(sat_info, now, steps, step_sec, tle_override=tle_override)
        if path:
            paths[sat_info.norad_id] = path
            names[sat_info.norad_id] = sat_info.name
    return {
        "paths": paths,
        "names": names,
        "steps": steps,
        "step_sec": step_sec,
        "source": meta["effective_source"],
        "meta": meta,
    }


@app.get("/api/orbital-elements/{norad_id}")
async def get_elements(
    norad_id: int,
    source: str = Query(default="embedded", pattern="^(embedded|celestrak)$"),
):
    """Keplerian orbital elements."""
    sat = get_satellite_by_id(norad_id)
    if not sat:
        raise HTTPException(status_code=404, detail="Satellite not found")
    if not is_operational(sat.status):
        raise HTTPException(
            status_code=409,
            detail=f"Satellite {norad_id} is archival ({sat.status}); elements unavailable",
        )
    tle_override, _meta = await _get_tle_override(source)
    return get_orbital_elements(sat, tle_override=tle_override)


# ── Endpoint: Inter-satellite links ────────────────────────────────
@app.get("/api/links")
async def get_links(
    comm_range_km: float = Query(default=2000.0, ge=50.0, le=2000.0),
    timestamp: Optional[str] = None,
    source: str = Query(default="embedded", pattern="^(embedded|celestrak)$"),
):
    """
    Calculate inter-satellite links (ISL).
    Returns all satellite pairs with distance and link status.
    ?comm_range_km=500 — range threshold (km)
    ?timestamp=... — calculation time (defaults to current UTC)
    ?source=embedded|celestrak — TLE data source.
    """
    dt = _parse_timestamp(timestamp)
    tle_override, meta = await _get_tle_override(source)
    positions = _filter_operational(propagate_all(dt, tle_override=tle_override))

    def has_los(p1, p2):
        """Check line-of-sight (link does not intersect Earth)."""
        R = 6371.0
        ax, ay, az = p1["eci"]["x"], p1["eci"]["y"], p1["eci"]["z"]
        bx, by, bz = p2["eci"]["x"], p2["eci"]["y"], p2["eci"]["z"]
        dx, dy, dz = bx - ax, by - ay, bz - az
        len_sq = dx * dx + dy * dy + dz * dz
        if len_sq == 0:
            return True
        t = max(0.0, min(1.0, -(ax * dx + ay * dy + az * dz) / len_sq))
        cx, cy, cz = ax + t * dx, ay + t * dy, az + t * dz
        return (cx * cx + cy * cy + cz * cz) >= R * R

    links = []
    for i in range(len(positions)):
        for j in range(i + 1, len(positions)):
            p1, p2 = positions[i], positions[j]
            dx = p1["eci"]["x"] - p2["eci"]["x"]
            dy = p1["eci"]["y"] - p2["eci"]["y"]
            dz = p1["eci"]["z"] - p2["eci"]["z"]
            dist = math.sqrt(dx * dx + dy * dy + dz * dz)
            los = has_los(p1, p2)
            connected = dist <= comm_range_km and los
            links.append({
                "norad_id_1": p1["norad_id"],
                "norad_id_2": p2["norad_id"],
                "name_1": p1["name"],
                "name_2": p2["name"],
                "distance_km": round(dist, 2),
                "los": los,
                "connected": connected,
            })

    active_count = sum(1 for lnk in links if lnk["connected"])
    blocked_by_earth = sum(1 for lnk in links if not lnk["los"])
    in_range_no_los = sum(1 for lnk in links if lnk["distance_km"] <= comm_range_km and not lnk["los"])
    return {
        "links": links,
        "active_count": active_count,
        "total_pairs": len(links),
        "satellites_count": len(positions),
        "blocked_by_earth": blocked_by_earth,
        "in_range_no_los": in_range_no_los,
        "comm_range_km": comm_range_km,
        "timestamp": (dt or datetime.now(timezone.utc)).isoformat(),
        "source": meta["effective_source"],
        "meta": meta,
    }


# ── Endpoint: Collision prediction ─────────────────────────────────
@app.get("/api/collisions")
async def get_collisions(
    threshold_km: float = Query(default=100.0, ge=1.0, le=1000.0),
    hours_ahead: float = Query(default=24.0, ge=1.0, le=168.0),
    source: str = Query(default="embedded", pattern="^(embedded|celestrak)$"),
):
    """
    Predict potential collisions between satellites.
    Returns pairs with minimum distance <= threshold_km over hours_ahead period.
    ?source=embedded|celestrak — TLE data source.
    """
    tle_override, meta = await _get_tle_override(source)
    approaches = predict_collisions(threshold_km, hours_ahead, tle_override=tle_override)
    return {
        "close_approaches": approaches,
        "count": len(approaches),
        "threshold_km": threshold_km,
        "hours_ahead": hours_ahead,
        "source": meta["effective_source"],
        "meta": meta,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ── Endpoint: Plane distribution optimization ─────────────────────
@app.get("/api/optimize-planes")
async def get_optimized_planes(
    num_satellites: int = Query(default=12, ge=3, le=50),
    num_planes: int = Query(default=3, ge=1, le=12),
    altitude_km: float = Query(default=550.0, ge=200.0, le=2000.0),
    inclination_deg: float = Query(default=55.0, ge=0.0, le=180.0),
):
    """
    Calculate optimal Walker-delta satellite distribution across orbital planes.
    """
    result = optimize_plane_distribution(num_satellites, num_planes, altitude_km, inclination_deg)
    return result


# ── Endpoint: StarAI ────────────────────────────────────────────────
@app.post("/api/starai/chat")
async def starai_chat(req: ChatRequest, request: Request):
    """Chat with StarAI — response + UI commands."""
    _check_chat_rate_limit(request)
    history = [{"role": m.role, "content": m.content} for m in req.history]
    result = await ask_starai(
        req.message,
        history,
        lang=req.lang,
    )
    return result


# ── Endpoint: Configuration ─────────────────────────────────────────
@app.get("/api/config")
async def get_config():
    """Initial configuration for frontend."""
    return {
        "earth_texture_url": "https://eoimages.gsfc.nasa.gov/images/imagerecords/74000/74393/world.200412.3x5400x2700.jpg",
        "earth_radius_km": 6371.0,
        "scale_factor": 1 / 6371.0,     # normalization: 1 unit = 1 earth radius
        "constellations": ["УниверСат", "МГТУ Баумана", "SPUTNIX", "Геоскан", "НИИЯФ МГУ", "Space-Pi"],
        "default_time_speed": 1.0,
        "update_interval_ms": 1000,
    }


# ── Entry point ─────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

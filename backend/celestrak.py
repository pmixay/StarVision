"""
celestrak.py — Automatic TLE data loading from CelesTrak.
Supports caching with TTL, TLE validation, race condition protection,
and fallback to built-in data.
"""

import asyncio
import logging
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx

from satellites import RUSSIAN_CUBESATS, is_operational

logger = logging.getLogger(__name__)

# Per-NORAD CATNR endpoint template. Our catalog is a small, fixed set
# (~15 IDs), so we query each satellite directly instead of downloading
# the 1.7 MB `active` group file. Direct CATNR responses are tiny
# (~150 B each) and 15 parallel requests typically resolve in well under
# 2 s, even on slow links — far more reliable than racing a multi-MB
# download against a tight wall-clock budget.
CELESTRAK_CATNR_URL = "https://celestrak.org/NORAD/elements/gp.php?CATNR={norad_id}&FORMAT=tle"

# Mirror endpoints used as a redundant secondary feed. AMSAT publishes
# amateur-band TLEs in plain TLE format and is reachable from networks
# where celestrak.org is occasionally blocked. It only covers a subset
# of the catalog, but partial live data is strictly better than nothing.
MIRROR_URLS = [
    "https://www.amsat.org/tle/current/nasabare.txt",
]

# TLE data cache: norad_id -> (tle_line1, tle_line2)
CACHE_TTL_SEC = 3600  # refresh every hour

# Hard ceiling on a single CelesTrak fetch wall-clock cost. With per-NORAD
# queries the entire 15-satellite batch typically lands in 4–8 s; we
# keep a generous 12 s cap so a brief 503 storm + retries still finishes
# inside the budget instead of leaving the cache half-populated.
FETCH_WALL_CLOCK_BUDGET_SEC = 12.0

# CelesTrak rate-limits aggressive parallel callers — once we cross
# roughly a dozen concurrent CATNR requests from the same IP, a sizeable
# fraction comes back as 503 Service Unavailable or read-timeout.
# Capping concurrency at 8 keeps the entire 15-satellite batch under
# 5 s wall-clock while still landing 15/15 on flaky links.
CELESTRAK_MAX_CONCURRENCY = 8

# Per-request retry budget for transient upstream conditions (HTTP 429 /
# 503 / network timeout). Two retries with a short backoff are enough to
# rescue the occasional satellite the rate-limiter knocks out without
# multiplying the wall-clock cost.
CELESTRAK_RETRIES = 2
CELESTRAK_RETRY_BACKOFF_SEC = 0.4

_tle_cache: dict[int, tuple[str, str]] = {}
_cache_timestamp: float = 0.0
# Lock and in-flight future are lazy-initialised so the module can be imported
# before any event loop exists (asyncio primitives bind to the current loop on
# construction; that fails under uvicorn's deferred startup).
_cache_lock: asyncio.Lock | None = None
_inflight_fetch: Optional["asyncio.Future[dict[int, tuple[str, str]]]"] = None
_last_fetch_ok: bool = False
_last_fetch_error: str | None = None
_last_fetch_attempt: float = 0.0


def _get_cache_lock() -> asyncio.Lock:
    global _cache_lock
    if _cache_lock is None:
        _cache_lock = asyncio.Lock()
    return _cache_lock


# Sanitised error codes that are safe to return to external clients.
# Full exception details (type, message, stack) stay in server logs and
# are never embedded in API responses — CodeQL flags that as
# py/stack-trace-exposure. Keep this list closed: anything not matching
# falls through to the generic UPSTREAM_UNAVAILABLE code.
ERR_TIMEOUT = "upstream_timeout"
ERR_NETWORK = "upstream_network_error"
ERR_UPSTREAM = "upstream_unavailable"
ERR_EMPTY = "upstream_empty_response"


def _classify_network_error(exc: BaseException) -> str:
    """Map any Python exception to an opaque, client-safe error code.
    The actual exception type / args are only logged server-side.
    """
    if isinstance(exc, httpx.TimeoutException):
        return ERR_TIMEOUT
    if isinstance(exc, httpx.NetworkError):
        return ERR_NETWORK
    if isinstance(exc, httpx.HTTPError):
        return ERR_UPSTREAM
    if isinstance(exc, asyncio.TimeoutError):
        return ERR_TIMEOUT
    return ERR_UPSTREAM


def get_cache_status() -> dict[str, object]:
    """Public snapshot of CelesTrak cache state. Used by API clients
    to display data freshness and surface network/parse failures instead
    of silently serving embedded data.

    `last_fetch_error` is a sanitised code (see constants above); raw
    exception details are not exposed.
    """
    now = time.time()
    age_sec: float | None = (now - _cache_timestamp) if _cache_timestamp > 0 else None
    last_attempt_age: float | None = (
        (now - _last_fetch_attempt) if _last_fetch_attempt > 0 else None
    )
    stale = age_sec is not None and age_sec > CACHE_TTL_SEC
    return {
        "entries": len(_tle_cache),
        "cache_age_sec": round(age_sec, 1) if age_sec is not None else None,
        "cache_ttl_sec": CACHE_TTL_SEC,
        "stale": stale,
        "last_fetch_ok": _last_fetch_ok,
        "last_fetch_error": _last_fetch_error,
        "last_fetch_age_sec": round(last_attempt_age, 1) if last_attempt_age is not None else None,
    }


# TLE line regex: basic format validation
_TLE_LINE1_RE = re.compile(r"^1 \d{5}[A-Z ]")
_TLE_LINE2_RE = re.compile(r"^2 \d{5} ")


def _tle_checksum(line: str) -> int:
    """Calculate TLE line checksum (modulo 10)."""
    total = 0
    for ch in line[:68]:
        if ch.isdigit():
            total += int(ch)
        elif ch == "-":
            total += 1
    return total % 10


def _validate_tle_line(line: str, line_num: int) -> bool:
    """Validate format and checksum of a TLE line."""
    if len(line) < 69:
        return False
    pattern = _TLE_LINE1_RE if line_num == 1 else _TLE_LINE2_RE
    if not pattern.match(line):
        return False
    expected_checksum = int(line[68])
    return _tle_checksum(line) == expected_checksum


def _tle_epoch_age_days(line1: str) -> float:
    """Calculate TLE epoch age in days relative to current UTC.
    Returns number of days since TLE epoch. Negative means TLE is from the future.
    """
    try:
        year_2d = int(line1[18:20])
        day_frac = float(line1[20:32])
        year = 2000 + year_2d if year_2d < 57 else 1900 + year_2d
        epoch = datetime(year, 1, 1, tzinfo=timezone.utc)
        epoch += timedelta(days=day_frac - 1)
        now = datetime.now(timezone.utc)
        return (now - epoch).total_seconds() / 86400.0
    except (ValueError, IndexError):
        return 9999.0  # failed to parse — treat as very old


def _is_tle_valid(line1: str, line2: str, max_age_days: float = 365.0) -> bool:
    """Full TLE validation: format, checksums, and epoch freshness."""
    if not _validate_tle_line(line1, 1):
        return False
    if not _validate_tle_line(line2, 2):
        return False
    age = _tle_epoch_age_days(line1)
    if age < 0 or age > max_age_days:
        return False
    return True


def _parse_tle_text(text: str) -> dict[int, tuple[str, str]]:
    """Parse TLE-format text (3 lines per satellite: name, line1, line2).
    Validates each set — skips corrupted entries."""
    lines = [line.strip() for line in text.strip().splitlines() if line.strip()]
    result: dict[int, tuple[str, str]] = {}

    i = 0
    while i < len(lines) - 2:
        # Skip lines that are not the start of a TLE block
        if not lines[i + 1].startswith("1 ") or not lines[i + 2].startswith("2 "):
            i += 1
            continue

        line1 = lines[i + 1]
        line2 = lines[i + 2]

        try:
            norad_id = int(line1[2:7].strip())
            if _is_tle_valid(line1, line2):
                result[norad_id] = (line1, line2)
            else:
                logger.debug("TLE validation failed for NORAD %d (checksum or epoch)", norad_id)
        except (ValueError, IndexError):
            # Invalid TLE line format — skip this satellite
            logger.debug("Failed to parse NORAD ID from TLE line: %r", line1)

        i += 3

    return result


async def fetch_celestrak_tle(norad_ids: list[int] | None = None) -> dict[int, tuple[str, str]]:
    """Fetch TLE from CelesTrak for the given NORAD IDs (catalog by default).

    Concurrency model:
    * A fast cache check runs without the lock — fresh, fully-populated cache
      returns immediately so polling endpoints don't queue behind each other.
    * If a network fetch is in flight, all callers share its result via the
      `_inflight_fetch` future. This collapses thundering-herd refreshes into
      a single round-trip.
    * The cache mutex (`_get_cache_lock()`) is only held while deciding whether
      to start a new fetch — never during the HTTP wait.
    """
    global _inflight_fetch

    if norad_ids is None:
        # Operational satellites only — CelesTrak returns 404 for decayed sats.
        norad_ids = [s.norad_id for s in RUSSIAN_CUBESATS if is_operational(s.status)]

    # Fast path: serve from fresh cache without taking the lock.
    now = time.time()
    if _tle_cache and (now - _cache_timestamp) < CACHE_TTL_SEC:
        cached = {nid: _tle_cache[nid] for nid in norad_ids if nid in _tle_cache}
        if len(cached) == len(norad_ids):
            return cached

    # Single-flight: coalesce concurrent refresh callers behind a shared
    # future so we never run two CelesTrak fetches in parallel.
    lock = _get_cache_lock()
    async with lock:
        now = time.time()
        # Re-check after acquiring the lock — another caller may have just
        # populated the cache while we were waiting.
        if _tle_cache and (now - _cache_timestamp) < CACHE_TTL_SEC:
            cached = {nid: _tle_cache[nid] for nid in norad_ids if nid in _tle_cache}
            if len(cached) == len(norad_ids):
                return cached
        if _inflight_fetch is not None and not _inflight_fetch.done():
            shared = _inflight_fetch
        else:
            shared = asyncio.get_running_loop().create_future()
            _inflight_fetch = shared
            asyncio.create_task(_run_celestrak_fetch(list(norad_ids), shared))

    try:
        await shared
    except Exception:
        # The runner records the failure in module state; we still attempt
        # to serve any stale cache below.
        pass

    cached_now = {nid: _tle_cache[nid] for nid in norad_ids if nid in _tle_cache}
    return cached_now


async def _run_celestrak_fetch(
    norad_ids: list[int],
    future: "asyncio.Future[dict[int, tuple[str, str]]]",
) -> None:
    """Worker that performs the actual CelesTrak round-trip.
    Always settles `future` (so awaiters wake up) and resets `_inflight_fetch`."""
    global _cache_timestamp, _last_fetch_ok, _last_fetch_error, _last_fetch_attempt
    global _inflight_fetch

    all_tle: dict[int, tuple[str, str]] = {}
    target_set = set(norad_ids)
    network_error: str | None = None
    _last_fetch_attempt = time.time()
    # Per-task outcome counters so we can emit a single summary line
    # instead of N tracebacks when CelesTrak is blocked.
    outcomes: dict[str, int] = {
        "ok": 0,
        "empty": 0,
        "network": 0,
        "transient": 0,
        "http": 0,
        "other": 0,
    }

    try:
        try:
            # Strategy: fan out one CATNR request per catalog NORAD ID,
            # capped at CELESTRAK_MAX_CONCURRENCY to stay below the
            # provider's rate-limit threshold (above ~12 simultaneous
            # callers a sizeable fraction comes back as 503). The AMSAT
            # mirror runs in parallel as an independent redundancy.
            # HTTP/2 is intentionally disabled: multiplexing 15 tiny
            # requests over one stream often serialises under load and
            # makes the slowest response the global tail latency.
            timeout = httpx.Timeout(connect=3.0, read=4.0, write=5.0, pool=5.0)
            limits = httpx.Limits(
                max_connections=CELESTRAK_MAX_CONCURRENCY + len(MIRROR_URLS),
                max_keepalive_connections=CELESTRAK_MAX_CONCURRENCY,
            )
            async with httpx.AsyncClient(
                timeout=timeout,
                http2=False,
                limits=limits,
                follow_redirects=True,
            ) as client:
                semaphore = asyncio.Semaphore(CELESTRAK_MAX_CONCURRENCY)
                tasks: list[asyncio.Task] = [
                    asyncio.create_task(
                        _fetch_url_with_retry(
                            client,
                            CELESTRAK_CATNR_URL.format(norad_id=nid),
                            semaphore=semaphore,
                        )
                    )
                    for nid in norad_ids
                ]
                for url in MIRROR_URLS:
                    tasks.append(asyncio.create_task(_fetch_url(client, url)))
                logger.info(
                    "TLE fetch: %d per-NORAD CATNR (max %d in flight) + %d mirror requests",
                    len(norad_ids),
                    CELESTRAK_MAX_CONCURRENCY,
                    len(MIRROR_URLS),
                )
                done, pending = await asyncio.wait(
                    tasks,
                    timeout=FETCH_WALL_CLOCK_BUDGET_SEC,
                )
                cancelled = len(pending)
                for fut in pending:
                    fut.cancel()

                for fut in done:
                    parsed, kind = fut.result()
                    outcomes[kind] = outcomes.get(kind, 0) + 1
                    if parsed:
                        for nid, tle in parsed.items():
                            if nid in target_set:
                                all_tle[nid] = tle

                # Network-class outcomes (timeout / DNS / refused) signal
                # upstream trouble even if some responses squeaked
                # through; the client still gets whatever landed.
                if outcomes["network"] > 0 or outcomes["transient"] > 0:
                    network_error = ERR_NETWORK
                level = logging.INFO if all_tle else logging.WARNING
                logger.log(
                    level,
                    "TLE fetch summary: %d ok, %d empty, %d network-error, "
                    "%d transient, %d http-error, %d other-error, "
                    "%d cancelled (budget %.1fs)",
                    outcomes["ok"],
                    outcomes["empty"],
                    outcomes["network"],
                    outcomes["transient"],
                    outcomes["http"],
                    outcomes["other"],
                    cancelled,
                    FETCH_WALL_CLOCK_BUDGET_SEC,
                )
        except Exception:
            # Anything that escapes the gather itself (e.g. client
            # construction failure) is genuinely unexpected — keep the
            # traceback. Per-request failures are handled inside
            # `_fetch_url` and reported via `outcomes`.
            logger.exception("CelesTrak fetch coordinator crashed")
            network_error = ERR_NETWORK

        if all_tle:
            _tle_cache.update(all_tle)
            _cache_timestamp = time.time()
            _last_fetch_ok = True
            _last_fetch_error = None
            logger.info(
                "TLE cache updated: %d/%d satellites fetched from CelesTrak",
                len(all_tle),
                len(norad_ids),
            )
            future.set_result({nid: _tle_cache[nid] for nid in norad_ids if nid in _tle_cache})
            return

        _last_fetch_ok = False
        _last_fetch_error = network_error or ERR_EMPTY
        if _tle_cache:
            logger.warning("CelesTrak unavailable, using stale cache (%d entries)", len(_tle_cache))
        future.set_result({nid: _tle_cache[nid] for nid in norad_ids if nid in _tle_cache})
    finally:
        if not future.done():
            future.set_result({})
        # Release the in-flight slot so the next caller can trigger a fresh fetch.
        if _inflight_fetch is future:
            _inflight_fetch = None


async def _fetch_url(
    client: httpx.AsyncClient,
    url: str,
) -> tuple[dict[int, tuple[str, str]], str]:
    """Fetch and parse TLE from a single URL.

    Returns `(parsed, outcome)` where `outcome` is one of
    ``ok``, ``empty``, ``network``, ``http``, ``other``. The coordinator
    aggregates outcomes into a single summary log line — that's why
    individual network failures here are silent (DEBUG only): emitting a
    full traceback per endpoint when CelesTrak is blocked from the user's
    network drowns the log in noise for an entirely expected condition.
    """
    try:
        resp = await client.get(url)
    except (httpx.TimeoutException, httpx.NetworkError, httpx.ProtocolError) as exc:
        logger.debug("CelesTrak unreachable for %s: %s", url, exc.__class__.__name__)
        return {}, "network"
    except httpx.HTTPError as exc:
        logger.debug("CelesTrak HTTP transport error for %s: %s", url, exc.__class__.__name__)
        return {}, "http"
    except asyncio.CancelledError:
        # The wall-clock cap cancelled us; bubble up so the task records
        # as cancelled rather than as a silent empty result.
        raise
    except Exception:
        logger.warning("CelesTrak fetch unexpected error for %s", url, exc_info=True)
        return {}, "other"

    if resp.status_code == 404:
        # 404 is normal for individual NORAD lookups — sat may be deorbited
        # or simply absent from CelesTrak's catalog. Not an error.
        return {}, "empty"
    if resp.status_code in (429, 503):
        # Transient: CelesTrak rate-limited us or the upstream pool is
        # momentarily exhausted. Mark as `transient` so the retry
        # wrapper knows it's worth another shot.
        logger.debug("CelesTrak HTTP %d (transient) for %s", resp.status_code, url)
        return {}, "transient"
    if resp.status_code >= 400:
        logger.debug("CelesTrak HTTP %d for %s", resp.status_code, url)
        return {}, "http"

    try:
        parsed = _parse_tle_text(resp.text)
    except Exception:
        logger.warning("Failed to parse TLE response from %s", url, exc_info=True)
        return {}, "other"

    if not parsed:
        return {}, "empty"
    logger.debug("Fetched %d TLE entries from %s", len(parsed), url.split("?")[0])
    return parsed, "ok"


async def _fetch_url_with_retry(
    client: httpx.AsyncClient,
    url: str,
    semaphore: asyncio.Semaphore,
) -> tuple[dict[int, tuple[str, str]], str]:
    """Concurrency-limited single-URL fetch with retry on transient
    upstream failure (network blip or HTTP 503/429 from CelesTrak's
    rate limiter). Returns the same `(parsed, outcome)` shape as
    `_fetch_url` so the coordinator's aggregation logic is unchanged.
    """
    async with semaphore:
        last_outcome: tuple[dict[int, tuple[str, str]], str] = ({}, "other")
        for attempt in range(CELESTRAK_RETRIES + 1):
            parsed, outcome = await _fetch_url(client, url)
            if outcome == "ok":
                return parsed, outcome
            last_outcome = (parsed, outcome)
            # Only retry the genuinely transient classes — a 4xx (other
            # than 429) won't get any better and burning the retry budget
            # on it would just delay the wall-clock cap for everyone else.
            if outcome in ("network", "transient") and attempt < CELESTRAK_RETRIES:
                # Linear backoff is enough — the goal is to side-step a
                # short rate-limit window, not to ride out a sustained
                # outage (the wall-clock budget will cancel us first).
                await asyncio.sleep(CELESTRAK_RETRY_BACKOFF_SEC * (attempt + 1))
                continue
            return parsed, outcome
        return last_outcome


async def get_tle_by_source(source: str = "embedded") -> dict[str, object]:
    """Get TLE data for the given source and return it alongside an
    explicit meta block describing where every entry came from.

    The response is:
      {
        "tle_data": [ {..., "source": "celestrak"|"embedded"|"embedded_fallback"}, ...],
        "meta": {
          "requested_source": "embedded" | "celestrak",
          "effective_source": "embedded" | "celestrak" | "celestrak_partial" | "embedded_fallback",
          "fallback": bool,      # True if we could not honor requested source fully
          "error": Optional[str], # Populated on network/parse failures
          ...cache_status
        }
      }

    Callers (API layer) are expected to surface `meta` to the client so
    end-users can see data freshness and any upstream failures.
    """

    def _with_meta(
        *,
        requested_source: str,
        effective_source: str,
        fallback: bool,
        error: str | None,
        tle_data: list[dict],
        fallback_count: int,
        live_count: int,
        network_error: bool,
    ) -> dict[str, object]:
        return {
            "requested_source": requested_source,
            "effective_source": effective_source,
            "fallback": fallback,
            "error": error,
            "operational_only": True,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "network_error": network_error,
            "fallback_count": fallback_count,
            "live_count": live_count,
            "total": len(tle_data),
            **get_cache_status(),
        }

    if source == "celestrak":
        try:
            live_tle = await fetch_celestrak_tle()
        except Exception as exc:
            # Log the raw error server-side; expose an opaque code to
            # the client so we never leak stack-trace / exception-type
            # detail through the API (CodeQL: py/stack-trace-exposure).
            logger.exception("CelesTrak fetch failed")
            err = _classify_network_error(exc)
            tle_list = _get_embedded_tle_list(tag="embedded_fallback")
            return {
                "tle_data": tle_list,
                "meta": _with_meta(
                    requested_source="celestrak",
                    effective_source="embedded_fallback",
                    fallback=True,
                    error=err,
                    tle_data=tle_list,
                    fallback_count=len(tle_list),
                    live_count=0,
                    network_error=True,
                ),
            }

        result: list[dict] = []
        any_fallback = False
        fallback_count = 0
        live_count = 0
        for s in RUSSIAN_CUBESATS:
            if not s.tle_line1 or not s.tle_line2:
                continue
            if not is_operational(s.status):
                # Archival satellite — never include in live TLE output.
                continue
            if s.norad_id in live_tle:
                line1, line2 = live_tle[s.norad_id]
                entry_source = "celestrak"
                live_count += 1
            else:
                line1, line2 = s.tle_line1, s.tle_line2
                entry_source = "embedded_fallback"
                any_fallback = True
                fallback_count += 1
            result.append(
                {
                    "norad_id": s.norad_id,
                    "name": s.name,
                    "constellation": s.constellation,
                    "tle_line1": line1,
                    "tle_line2": line2,
                    "source": entry_source,
                }
            )

        fresh_status = get_cache_status()
        effective = "celestrak"
        if not result:
            effective = "embedded_fallback"
        elif any_fallback:
            effective = "celestrak_partial"

        return {
            "tle_data": result,
            "meta": _with_meta(
                requested_source="celestrak",
                effective_source=effective,
                fallback=any_fallback or not result,
                error=(
                    fresh_status.get("last_fetch_error")
                    if not fresh_status.get("last_fetch_ok")
                    else None
                ),
                tle_data=result,
                fallback_count=fallback_count,
                live_count=live_count,
                network_error=not bool(fresh_status.get("last_fetch_ok")),
            ),
        }

    # Embedded
    tle_list = _get_embedded_tle_list(tag="embedded")
    return {
        "tle_data": tle_list,
        "meta": _with_meta(
            requested_source="embedded",
            effective_source="embedded",
            fallback=False,
            error=None,
            tle_data=tle_list,
            fallback_count=0,
            live_count=0,
            network_error=False,
        ),
    }


def _get_embedded_tle_list(tag: str = "embedded") -> list[dict]:
    """Built-in TLE as list of dicts. Archival satellites are excluded."""
    return [
        {
            "norad_id": s.norad_id,
            "name": s.name,
            "constellation": s.constellation,
            "tle_line1": s.tle_line1,
            "tle_line2": s.tle_line2,
            "source": tag,
        }
        for s in RUSSIAN_CUBESATS
        if s.tle_line1 and s.tle_line2 and is_operational(s.status)
    ]


def invalidate_cache():
    """Reset TLE cache (for forced refresh)."""
    global _tle_cache, _cache_timestamp, _last_fetch_ok, _last_fetch_error, _last_fetch_attempt
    _tle_cache = {}
    _cache_timestamp = 0.0
    _last_fetch_ok = False
    _last_fetch_error = None
    _last_fetch_attempt = 0.0
    # An in-flight fetch is intentionally left alone — its result will simply
    # populate the freshly-cleared cache when it lands. Cancelling here would
    # raise CancelledError in every awaiter coalesced behind it.

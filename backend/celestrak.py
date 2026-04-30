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

# Per-NORAD CATNR endpoint template. Our catalog is small (~15 IDs), so
# we can query each satellite directly when bulk fetches don't cover it.
# CATNR responses are tiny (~150 B each) but 15 parallel hits trip
# CelesTrak's per-IP rate limiter — that's why per-NORAD is now used
# only as a fill-in for satellites missing from the bulk groups, not as
# the primary path.
CELESTRAK_CATNR_URL = "https://celestrak.org/NORAD/elements/gp.php?CATNR={norad_id}&FORMAT=tle"

# Bulk endpoints — single HTTP request returns the entire TLE catalog
# in one shot. One bulk request is far less likely to trip rate-limiting
# than 15 parallel CATNR queries. Listed by reachability + coverage so
# the most reliable, highest-coverage source is tried first.
#
# Each entry is `(url, parser)` so we can mix plain-TLE and JSON sources
# under the same fetch pipeline. The parser converts the raw response
# body into `{norad_id: (line1, line2)}`.
#
#   * SatNOGS DB     ~500 KB JSON of ~1500 sats. Open data, hosted on
#                    *.satnogs.org infrastructure independent of
#                    celestrak.org — so it stays reachable from networks
#                    that have CelesTrak rate-limited or geo-blocked.
#                    Covers our entire catalog (15/15) including the
#                    non-amateur scientific missions.
#   * CelesTrak `cubesat` group ~15 KB / ~90 sats.
#   * CelesTrak `amateur` group ~16 KB / ~95 sats — covers most of the
#                    УниверСат / Space-Pi catalog (their spacecraft
#                    carry amateur transponders).
#   * CelesTrak `education` group ~10 KB / ~50 sats.
#   * CelesTrak `active`   ~1.7 MB / ~9000 sats — full active catalog,
#                    last-resort because of the bandwidth cost.
BULK_SOURCES: list[tuple[str, str]] = [
    ("https://db.satnogs.org/api/tle/?format=json", "json"),
    ("https://celestrak.org/NORAD/elements/gp.php?GROUP=cubesat&FORMAT=tle", "tle"),
    ("https://celestrak.org/NORAD/elements/gp.php?GROUP=amateur&FORMAT=tle", "tle"),
    ("https://celestrak.org/NORAD/elements/gp.php?GROUP=education&FORMAT=tle", "tle"),
    ("https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle", "tle"),
]

# Backwards-compatible alias for tests / external introspection.
CELESTRAK_GROUP_URLS = [url for url, fmt in BULK_SOURCES if fmt == "tle"]

# Mirror endpoints used as a redundant secondary feed. AMSAT publishes
# amateur-band TLEs in plain TLE format and is reachable from networks
# where celestrak.org is occasionally blocked. It only covers a subset
# of the catalog, but partial live data is strictly better than nothing.
MIRROR_URLS = [
    "https://www.amsat.org/tle/current/nasabare.txt",
]

# TLE data cache: norad_id -> (tle_line1, tle_line2)
CACHE_TTL_SEC = 3600  # refresh every hour

# Hard ceiling on a single CelesTrak fetch wall-clock cost. The bulk-first
# strategy lands all 15 TLEs in one ~200–600 ms response, so most fetches
# finish in under a second. The 25 s ceiling is for the worst-case "first
# bulk fails, fall through to per-NORAD fill-in" path on a slow link.
FETCH_WALL_CLOCK_BUDGET_SEC = 25.0

# Concurrency caps. Bulk endpoints are large enough that more than 4 in
# flight gives diminishing returns and increases the chance of triggering
# CelesTrak's per-IP throttle. Per-NORAD CATNR fan-out is even more
# rate-sensitive — keep it modest so a fill-in pass doesn't tip the IP
# into a 503 storm that the bulk path is trying to avoid.
CELESTRAK_BULK_CONCURRENCY = 4
CELESTRAK_MAX_CONCURRENCY = 4

# Per-request retry budget for transient upstream conditions (HTTP 429 /
# 503 / network timeout). One retry is enough to side-step a single
# rate-limit window without serialising the whole budget behind retry
# backoffs. The previous "3 retries with 0.6 s backoff" was actively
# harmful: each task consumed up to 12 s of the 20 s budget by itself,
# leaving no room for the second batch and showing up in logs as
# "8 network-error, 4 cancelled".
CELESTRAK_RETRIES = 1
CELESTRAK_RETRY_BACKOFF_SEC = 0.5

# Minimum time between successive partial-cache refetch attempts. When a
# fetch lands only N<15 satellites the fast-path check intentionally
# fails (len(cached) != len(norad_ids)), which would otherwise let every
# /api/positions or /api/tle call kick off a brand-new CelesTrak fetch
# — that's a self-inflicted DoS against the upstream. With this throttle
# we serve the partial cache verbatim until the cool-down expires, then
# allow a single fresh attempt to fill the missing IDs.
PARTIAL_REFETCH_COOLDOWN_SEC = 60.0

# Sub-budgets for the two phases of the runner. Phase 1 fans out the
# bulk + mirror sources concurrently; whatever lands in this window
# becomes the "bulk result". Phase 2 only fires per-NORAD CATNR for
# satellites still missing afterwards. Splitting the budget like this
# guarantees the bulk pass always gets a fair slice — the old "everything
# in one giant pool" coordinator could see retries on per-NORAD swallow
# the whole budget. The bulk pass usually exits early via target-set
# coverage well before the deadline, leaving most of the wall-clock for
# the (rare) fill-in pass.
BULK_PHASE_BUDGET_SEC = 10.0
FILL_PHASE_BUDGET_SEC = 14.0

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


def _parse_satnogs_json(text: str) -> dict[int, tuple[str, str]]:
    """Parse the SatNOGS DB `/api/tle/?format=json` response.

    SatNOGS publishes a JSON array of `{tle0, tle1, tle2, norad_cat_id, ...}`
    objects. Single request, ~500 KB, includes the full TLE catalog —
    crucially, hosted on a different infrastructure than celestrak.org so
    it stays reachable from networks that have CelesTrak rate-limited or
    geo-blocked. We validate each line the same way as the plain-text
    parser, so corrupted entries are skipped silently.
    """
    import json

    try:
        items = json.loads(text)
    except (ValueError, json.JSONDecodeError):
        return {}
    if not isinstance(items, list):
        return {}

    result: dict[int, tuple[str, str]] = {}
    for entry in items:
        if not isinstance(entry, dict):
            continue
        line1 = entry.get("tle1")
        line2 = entry.get("tle2")
        norad_raw = entry.get("norad_cat_id") or entry.get("norad_id")
        if not isinstance(line1, str) or not isinstance(line2, str):
            continue
        try:
            norad_id = int(norad_raw) if norad_raw is not None else int(line1[2:7].strip())
        except (TypeError, ValueError, IndexError):
            continue
        if _is_tle_valid(line1, line2):
            result[norad_id] = (line1, line2)
    return result


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
        # Partial cache + recent attempt → serve what we have without
        # hammering CelesTrak. Each polling caller would otherwise
        # restart a fresh fetch, which both delays the response and DoS-es
        # the upstream when a few NORAD IDs are reliably failing.
        if cached and (now - _last_fetch_attempt) < PARTIAL_REFETCH_COOLDOWN_SEC:
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
            if cached and (now - _last_fetch_attempt) < PARTIAL_REFETCH_COOLDOWN_SEC:
                return cached
        if _inflight_fetch is not None and not _inflight_fetch.done():
            shared = _inflight_fetch
        else:
            # On a partial-cache top-up, re-fetch ONLY the NORAD IDs that
            # are still missing. That keeps the wall-clock budget useful
            # for the satellites we actually need instead of paying for
            # 15 round-trips every minute.
            missing = [nid for nid in norad_ids if nid not in _tle_cache]
            target = missing if (missing and _tle_cache) else list(norad_ids)
            shared = asyncio.get_running_loop().create_future()
            _inflight_fetch = shared
            asyncio.create_task(_run_celestrak_fetch(target, shared))

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

    def _ingest(parsed: dict[int, tuple[str, str]]) -> None:
        for nid, tle in parsed.items():
            if nid in target_set:
                all_tle[nid] = tle

    try:
        try:
            # Two-phase strategy:
            #   1. Bulk + mirror — single requests that each return many
            #      TLEs. One CelesTrak GROUP fetch typically covers our
            #      whole catalog in <500 ms; this is far less likely to
            #      trip the per-IP rate limiter than 15 parallel CATNR
            #      requests.
            #   2. Per-NORAD fill-in — only for the IDs that didn't show
            #      up in any bulk source. Almost always empty; when not,
            #      it's at most a few requests.
            # HTTP/2 is intentionally disabled: multiplexing many small
            # requests over one stream often serialises under load and
            # makes the slowest response the global tail latency.
            timeout = httpx.Timeout(connect=4.0, read=10.0, write=5.0, pool=5.0)
            limits = httpx.Limits(
                max_connections=CELESTRAK_BULK_CONCURRENCY
                + CELESTRAK_MAX_CONCURRENCY
                + len(MIRROR_URLS),
                max_keepalive_connections=CELESTRAK_BULK_CONCURRENCY,
            )
            async with httpx.AsyncClient(
                timeout=timeout,
                http2=False,
                limits=limits,
                follow_redirects=True,
                headers={"User-Agent": "StarVision/1.3 (+celestrak-cubesat-tracker)"},
            ) as client:
                # ── Phase 1: bulk + mirror ─────────────────────────────
                # Stop early as soon as every target NORAD ID has been
                # ingested. CelesTrak rewards minimal load: skipping an
                # extra GROUP request once we already have 15/15 saves
                # both bandwidth and rate-limit budget for everyone.
                bulk_sem = asyncio.Semaphore(CELESTRAK_BULK_CONCURRENCY)
                bulk_tasks: list[asyncio.Task] = []
                for url, fmt in BULK_SOURCES:
                    bulk_tasks.append(
                        asyncio.create_task(_fetch_url_throttled(client, url, bulk_sem, fmt=fmt))
                    )
                for url in MIRROR_URLS:
                    bulk_tasks.append(
                        asyncio.create_task(_fetch_url_throttled(client, url, bulk_sem, fmt="tle"))
                    )
                logger.info(
                    "TLE fetch phase 1: %d bulk + %d mirror sources (target %d sats)",
                    len(BULK_SOURCES),
                    len(MIRROR_URLS),
                    len(norad_ids),
                )
                phase1_deadline = time.time() + BULK_PHASE_BUDGET_SEC
                pending_phase1: set[asyncio.Task] = set(bulk_tasks)
                cancelled = 0
                while pending_phase1:
                    timeout_left = max(0.05, phase1_deadline - time.time())
                    done_phase1, pending_phase1 = await asyncio.wait(
                        pending_phase1,
                        timeout=timeout_left,
                        return_when=asyncio.FIRST_COMPLETED,
                    )
                    if not done_phase1:
                        # Hit the phase-1 deadline.
                        break
                    for fut in done_phase1:
                        parsed, kind = fut.result()
                        outcomes[kind] = outcomes.get(kind, 0) + 1
                        if parsed:
                            _ingest(parsed)
                    if target_set <= all_tle.keys():
                        # Full coverage already — no need to wait for
                        # additional bulk sources.
                        break
                cancelled += len(pending_phase1)
                for fut in pending_phase1:
                    fut.cancel()

                # ── Phase 2: per-NORAD fill-in for misses ─────────────
                missing = [nid for nid in norad_ids if nid not in all_tle]
                fill_tasks: list[asyncio.Task] = []
                if missing:
                    fill_sem = asyncio.Semaphore(CELESTRAK_MAX_CONCURRENCY)
                    fill_tasks = [
                        asyncio.create_task(
                            _fetch_url_with_retry(
                                client,
                                CELESTRAK_CATNR_URL.format(norad_id=nid),
                                semaphore=fill_sem,
                            )
                        )
                        for nid in missing
                    ]
                    logger.info(
                        "TLE fetch phase 2: per-NORAD fill-in for %d missing sats",
                        len(missing),
                    )
                    fill_done, fill_pending = await asyncio.wait(
                        fill_tasks,
                        timeout=FILL_PHASE_BUDGET_SEC,
                    )
                    cancelled += len(fill_pending)
                    for fut in fill_pending:
                        fut.cancel()
                    for fut in fill_done:
                        try:
                            parsed, kind = fut.result()
                        except Exception:
                            outcomes["other"] = outcomes.get("other", 0) + 1
                            continue
                        outcomes[kind] = outcomes.get(kind, 0) + 1
                        if parsed:
                            _ingest(parsed)

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
                    "%d cancelled, landed %d/%d (budget %.1fs)",
                    outcomes["ok"],
                    outcomes["empty"],
                    outcomes["network"],
                    outcomes["transient"],
                    outcomes["http"],
                    outcomes["other"],
                    cancelled,
                    len(all_tle),
                    len(norad_ids),
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
            # Only flag the fetch as "fully OK" when every requested
            # satellite landed. A partial result still updates the cache,
            # but health/status surfaces the degradation so the UI can
            # show "celestrak_partial" instead of pretending we have
            # full live data.
            fully_satisfied = all(nid in _tle_cache for nid in norad_ids)
            if fully_satisfied:
                _last_fetch_ok = True
                _last_fetch_error = None
            else:
                _last_fetch_ok = False
                _last_fetch_error = network_error or ERR_EMPTY
            logger.info(
                "TLE cache updated: %d/%d satellites fetched from CelesTrak (partial=%s)",
                len(all_tle),
                len(norad_ids),
                not fully_satisfied,
            )
            # The outer fetcher re-reads `_tle_cache` after the future
            # settles, so what we put here is only consumed by tests and
            # by callers that share this future as a signal. Echo back
            # the IDs we attempted, populated from the merged cache.
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


async def _fetch_url_throttled(
    client: httpx.AsyncClient,
    url: str,
    semaphore: asyncio.Semaphore,
    fmt: str = "tle",
) -> tuple[dict[int, tuple[str, str]], str]:
    """Concurrency-capped wrapper around `_fetch_url`. The bulk + mirror
    sources are fanned out concurrently, but we still want to keep the
    open-socket count low so a single fetch coordinator can't accidentally
    saturate the upstream's per-IP connection limit.
    """
    async with semaphore:
        return await _fetch_url(client, url, fmt=fmt)


async def _fetch_url(
    client: httpx.AsyncClient,
    url: str,
    fmt: str = "tle",
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
        parser = _parse_satnogs_json if fmt == "json" else _parse_tle_text
        parsed = parser(resp.text)
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

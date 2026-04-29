"""Tests for the CelesTrak cache: single-flight, fast-path hit, stale fallback.

These tests exercise the fetch coordinator (`fetch_celestrak_tle`) without
making real HTTP calls — the inner worker is monkey-patched to a deterministic
in-memory implementation so we can assert ordering invariants.
"""

import asyncio

import pytest

import celestrak
from celestrak import (
    CACHE_TTL_SEC,
    fetch_celestrak_tle,
    get_cache_status,
    invalidate_cache,
)
from satellites import RUSSIAN_CUBESATS, is_operational


@pytest.fixture(autouse=True)
def _reset_state():
    invalidate_cache()
    celestrak._inflight_fetch = None  # type: ignore[attr-defined]
    yield
    invalidate_cache()
    celestrak._inflight_fetch = None  # type: ignore[attr-defined]


def _live_norads():
    return [s.norad_id for s in RUSSIAN_CUBESATS if is_operational(s.status)]


@pytest.mark.asyncio
async def test_concurrent_callers_share_one_fetch(monkeypatch):
    """N concurrent fetches must trigger exactly one call to the network worker."""
    call_count = 0

    async def fake_runner(norad_ids, future):
        nonlocal call_count
        call_count += 1
        await asyncio.sleep(0.05)  # simulate network latency
        result = {nid: (f"line1-{nid}", f"line2-{nid}") for nid in norad_ids}
        # Mimic the real runner: populate the cache and settle the future.
        celestrak._tle_cache.update(result)  # type: ignore[attr-defined]
        celestrak._cache_timestamp = celestrak.time.time()  # type: ignore[attr-defined]
        celestrak._last_fetch_ok = True  # type: ignore[attr-defined]
        celestrak._last_fetch_error = None  # type: ignore[attr-defined]
        future.set_result(result)
        celestrak._inflight_fetch = None  # type: ignore[attr-defined]

    monkeypatch.setattr(celestrak, "_run_celestrak_fetch", fake_runner)

    results = await asyncio.gather(*(fetch_celestrak_tle() for _ in range(8)))

    assert call_count == 1, "single-flight must collapse N callers into 1 fetch"
    sample = results[0]
    assert all(r == sample for r in results), "all callers must see the same result"


@pytest.mark.asyncio
async def test_fast_path_serves_fresh_cache_without_runner(monkeypatch):
    """When the cache is fresh and complete, the runner is never invoked."""
    live = _live_norads()
    # Pre-populate the cache as if a previous fetch had succeeded.
    for nid in live:
        celestrak._tle_cache[nid] = (f"l1-{nid}", f"l2-{nid}")  # type: ignore[attr-defined]
    celestrak._cache_timestamp = celestrak.time.time()  # type: ignore[attr-defined]

    runner_called = False

    async def fake_runner(*_args, **_kwargs):  # pragma: no cover — must not run
        nonlocal runner_called
        runner_called = True

    monkeypatch.setattr(celestrak, "_run_celestrak_fetch", fake_runner)

    result = await fetch_celestrak_tle()
    assert runner_called is False
    assert set(result.keys()) == set(live)


def test_invalidate_cache_resets_state():
    celestrak._tle_cache[1] = ("a", "b")  # type: ignore[attr-defined]
    celestrak._cache_timestamp = 12345.0  # type: ignore[attr-defined]
    celestrak._last_fetch_ok = True  # type: ignore[attr-defined]
    celestrak._last_fetch_error = "x"  # type: ignore[attr-defined]

    invalidate_cache()

    status = get_cache_status()
    assert status["entries"] == 0
    assert status["last_fetch_ok"] is False
    assert status["last_fetch_error"] is None


@pytest.mark.asyncio
async def test_fetch_url_classifies_network_failures_quietly(monkeypatch, caplog):
    """A connect-timeout from httpx must surface as the `network` outcome
    and must NOT emit a stack trace — the per-task summary is the only
    log line we want when CelesTrak is blocked from the user's network.
    """
    import logging

    import httpx

    class _BoomClient:
        async def get(self, _url):
            raise httpx.ConnectTimeout("blocked")

    caplog.set_level(logging.DEBUG, logger=celestrak.logger.name)
    parsed, outcome = await celestrak._fetch_url(_BoomClient(), "https://example/x")  # type: ignore[arg-type]

    assert parsed == {}
    assert outcome == "network"
    # No traceback frame should leak into the log records — every
    # known network error is logged at DEBUG without exc_info.
    assert all(rec.exc_info is None for rec in caplog.records)


@pytest.mark.asyncio
async def test_fetch_url_returns_empty_outcome_on_404(monkeypatch):
    """404 is normal for individual NORAD lookups (deorbited / absent)."""

    class _Resp:
        status_code = 404
        text = ""

    class _Client:
        async def get(self, _url):
            return _Resp()

    parsed, outcome = await celestrak._fetch_url(_Client(), "https://example/x")  # type: ignore[arg-type]
    assert parsed == {}
    assert outcome == "empty"


@pytest.mark.asyncio
async def test_stale_cache_is_served_when_runner_returns_empty(monkeypatch):
    """If the worker fails to fetch fresh data, callers should get the stale cache."""
    # Pre-populate so that even though TTL-fresh check finds it complete,
    # we still want to verify "no new network result" behaviour.
    live = _live_norads()
    for nid in live:
        celestrak._tle_cache[nid] = (f"stale-{nid}", f"stale2-{nid}")  # type: ignore[attr-defined]
    # Make the cache stale
    celestrak._cache_timestamp = celestrak.time.time() - (CACHE_TTL_SEC + 10)  # type: ignore[attr-defined]

    async def empty_runner(_norad_ids, future):
        # Simulate network failure: don't populate the cache, just settle empty.
        future.set_result({})
        celestrak._inflight_fetch = None  # type: ignore[attr-defined]

    monkeypatch.setattr(celestrak, "_run_celestrak_fetch", empty_runner)

    result = await fetch_celestrak_tle()
    # Stale cache entries are still served when refresh fails.
    assert all(nid in result for nid in live)
    assert result[live[0]] == (f"stale-{live[0]}", f"stale2-{live[0]}")

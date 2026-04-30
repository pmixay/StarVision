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


@pytest.mark.asyncio
async def test_partial_cache_serves_within_cooldown_without_refetch(monkeypatch):
    """When the previous fetch landed only a subset of NORAD IDs, the
    coordinator must serve the partial cache verbatim during the
    cooldown window instead of restarting a full network fetch on every
    polling caller. That used to cause an inadvertent self-DoS against
    CelesTrak — every /api/positions tick would trigger another round-trip.
    """
    live = _live_norads()
    partial = live[:3]
    for nid in partial:
        celestrak._tle_cache[nid] = (f"l1-{nid}", f"l2-{nid}")  # type: ignore[attr-defined]
    celestrak._cache_timestamp = celestrak.time.time()  # type: ignore[attr-defined]
    # Pretend the last attempt landed half a second ago — well inside the
    # cooldown window.
    celestrak._last_fetch_attempt = celestrak.time.time() - 0.5  # type: ignore[attr-defined]

    runner_called = False

    async def fake_runner(*_args, **_kwargs):
        nonlocal runner_called
        runner_called = True

    monkeypatch.setattr(celestrak, "_run_celestrak_fetch", fake_runner)

    result = await fetch_celestrak_tle()
    assert runner_called is False, "partial cooldown must suppress refetch"
    # Partial cache should still be returned (3 of N).
    assert set(result.keys()) == set(partial)


@pytest.mark.asyncio
async def test_partial_cache_topup_only_requests_missing_norads(monkeypatch):
    """When the cooldown has elapsed, the next refetch must target ONLY
    the missing IDs — re-querying the satellites we already have wastes
    the wall-clock budget and bumps the chance of another partial result.
    """
    live = _live_norads()
    have = live[:3]
    missing = live[3:]
    for nid in have:
        celestrak._tle_cache[nid] = (f"l1-{nid}", f"l2-{nid}")  # type: ignore[attr-defined]
    celestrak._cache_timestamp = celestrak.time.time()  # type: ignore[attr-defined]
    # Last attempt outside the cooldown — a refetch is allowed.
    celestrak._last_fetch_attempt = (  # type: ignore[attr-defined]
        celestrak.time.time() - celestrak.PARTIAL_REFETCH_COOLDOWN_SEC - 5
    )

    received_targets: list[list[int]] = []

    async def fake_runner(target_ids, future):
        received_targets.append(list(target_ids))
        # Simulate the missing satellites coming back this time.
        for nid in target_ids:
            celestrak._tle_cache[nid] = (f"new-{nid}", f"new2-{nid}")  # type: ignore[attr-defined]
        celestrak._cache_timestamp = celestrak.time.time()  # type: ignore[attr-defined]
        celestrak._last_fetch_ok = True  # type: ignore[attr-defined]
        celestrak._last_fetch_error = None  # type: ignore[attr-defined]
        future.set_result({nid: celestrak._tle_cache[nid] for nid in target_ids})  # type: ignore[attr-defined]
        celestrak._inflight_fetch = None  # type: ignore[attr-defined]

    monkeypatch.setattr(celestrak, "_run_celestrak_fetch", fake_runner)

    result = await fetch_celestrak_tle()
    assert len(received_targets) == 1, "exactly one fetch attempt"
    # Only the missing IDs should have been queried.
    assert set(received_targets[0]) == set(missing)
    # Caller still gets the full picture (already-cached + new).
    assert set(result.keys()) == set(live)


@pytest.mark.asyncio
async def test_partial_fetch_marks_status_not_ok(monkeypatch):
    """A fetch that landed only a subset of requested NORAD IDs must
    NOT report `last_fetch_ok=True`. Health checks key off that flag to
    decide whether to flag the deployment as degraded — falsely claiming
    "OK" hides the partial state from operators.
    """
    live = _live_norads()
    target_ids = list(live)

    async def fake_url_fetch(_client, url, *_args, **_kwargs):  # noqa: ARG001
        # Match the celestrak runner's expected return shape.
        return {}, "network"

    # Drive the real coordinator with a fake per-URL fetcher that always
    # fails. We expect: empty all_tle, _last_fetch_ok=False, network error
    # populated.
    monkeypatch.setattr(celestrak, "_fetch_url_with_retry", fake_url_fetch)
    monkeypatch.setattr(celestrak, "_fetch_url", fake_url_fetch)

    fut: asyncio.Future = asyncio.get_event_loop().create_future()
    await celestrak._run_celestrak_fetch(target_ids, fut)  # type: ignore[attr-defined]

    status = get_cache_status()
    assert status["last_fetch_ok"] is False
    assert status["last_fetch_error"] is not None


def test_satnogs_json_parser_extracts_valid_tles():
    """The SatNOGS DB returns a JSON array of TLE entries with a
    different shape than CelesTrak's plain-text format. The parser must
    pull out NORAD ID, line1, line2 — and reject malformed lines via
    the same `_is_tle_valid` check used for the text parser, so a
    corrupted SatNOGS entry can't poison the cache.
    """
    import json

    from celestrak import _parse_satnogs_json

    # Use a real, well-formed TLE from the embedded catalog so the
    # checksum + epoch validators accept it.
    payload = json.dumps(
        [
            {
                "tle0": "0 ДЕКАРТ",
                "tle1": "1 46493U 20068H   26091.50000000  .00000450  00000-0  28000-4 0  9998",
                "tle2": "2 46493  97.4100  90.0000 0011500  80.0000 280.0000 15.22000000 28003",
                "norad_cat_id": 46493,
            },
            # Garbage entry — must be ignored, not crash the parser.
            {"tle1": "not a tle", "tle2": "also not", "norad_cat_id": 99999},
            # Missing fields — also ignored.
            {"tle0": "incomplete"},
        ]
    )
    parsed = _parse_satnogs_json(payload)
    assert 46493 in parsed
    assert 99999 not in parsed
    assert parsed[46493][0].startswith("1 46493")


def test_satnogs_json_parser_handles_non_array_payloads():
    """A malformed JSON body (object / scalar / non-JSON) must produce
    an empty dict rather than blow up the runner — bad upstream
    responses should look like an empty source, not crash the fetch.
    """
    from celestrak import _parse_satnogs_json

    assert _parse_satnogs_json("") == {}
    assert _parse_satnogs_json("not json") == {}
    assert _parse_satnogs_json('{"object": "not array"}') == {}
    assert _parse_satnogs_json("[]") == {}


@pytest.mark.asyncio
async def test_bulk_first_lands_full_catalog_without_per_norad(monkeypatch):
    """The runner's primary path is now a single bulk GROUP fetch. When
    that returns every target NORAD ID we MUST NOT fall through to the
    per-NORAD fill-in — that defeats the whole point of bulk and would
    re-introduce the rate-limit storm we saw in production.
    """
    live = _live_norads()

    catnr_called = 0

    async def fake_throttled(_client, url, _sem, fmt="tle"):  # noqa: ARG001
        # Pretend the first bulk source carries every target sat. Real
        # CelesTrak GROUP responses contain hundreds of TLEs; the runner
        # filters to target_set, so a noisy payload is safe to fake.
        if "GROUP=" in url:
            return ({nid: (f"l1-{nid}", f"l2-{nid}") for nid in live}, "ok")
        # Mirrors return a strictly-amateur subset.
        return ({}, "empty")

    async def fake_with_retry(_client, url, semaphore):  # noqa: ARG001
        nonlocal catnr_called
        catnr_called += 1
        return ({}, "ok")

    monkeypatch.setattr(celestrak, "_fetch_url_throttled", fake_throttled)
    monkeypatch.setattr(celestrak, "_fetch_url_with_retry", fake_with_retry)

    fut: asyncio.Future = asyncio.get_event_loop().create_future()
    await celestrak._run_celestrak_fetch(list(live), fut)  # type: ignore[attr-defined]

    assert catnr_called == 0, "per-NORAD must not run when bulk covered everything"
    status = get_cache_status()
    assert status["entries"] == len(live)
    assert status["last_fetch_ok"] is True


@pytest.mark.asyncio
async def test_per_norad_fillin_only_for_missing(monkeypatch):
    """When bulk sources return an incomplete subset, the runner must
    fall through to per-NORAD CATNR ONLY for the satellites that are
    still missing — querying everything again would waste the budget
    and trip rate-limiting on the IDs we already have.
    """
    live = _live_norads()
    bulk_covers = set(live[:10])
    catnr_targets: list[str] = []

    async def fake_throttled(_client, url, _sem, fmt="tle"):  # noqa: ARG001
        if "GROUP=" in url:
            # First bulk delivers a subset; further bulks empty.
            if "GROUP=cubesat" in url:
                return ({nid: (f"b1-{nid}", f"b2-{nid}") for nid in bulk_covers}, "ok")
            return ({}, "empty")
        return ({}, "empty")

    async def fake_with_retry(_client, url, semaphore):  # noqa: ARG001
        catnr_targets.append(url)
        # Extract the NORAD ID and supply a TLE for it.
        nid = int(url.split("CATNR=")[1].split("&")[0])
        return ({nid: (f"c1-{nid}", f"c2-{nid}")}, "ok")

    monkeypatch.setattr(celestrak, "_fetch_url_throttled", fake_throttled)
    monkeypatch.setattr(celestrak, "_fetch_url_with_retry", fake_with_retry)

    fut: asyncio.Future = asyncio.get_event_loop().create_future()
    await celestrak._run_celestrak_fetch(list(live), fut)  # type: ignore[attr-defined]

    # CATNR fill-in only for the 5 sats absent from the bulk response.
    expected_missing = set(live) - bulk_covers
    queried_nids = {int(u.split("CATNR=")[1].split("&")[0]) for u in catnr_targets}
    assert queried_nids == expected_missing
    status = get_cache_status()
    assert status["entries"] == len(live)
    assert status["last_fetch_ok"] is True


@pytest.mark.asyncio
async def test_full_fetch_marks_status_ok(monkeypatch):
    """The happy path — every requested NORAD ID lands — must set
    `last_fetch_ok=True` so the /api/health probe goes green.
    """
    live = _live_norads()

    async def fake_url_fetch(_client, url, *_args, **_kwargs):  # noqa: ARG001
        # Extract the NORAD ID from the URL and return a valid TLE-shaped
        # dict. The runner only consumes the parsed/outcome tuple — actual
        # validation lives in `_parse_tle_text`, which we bypass here.
        if "CATNR=" in url:
            nid = int(url.split("CATNR=")[1].split("&")[0])
            return ({nid: (f"l1-{nid}", f"l2-{nid}")}, "ok")
        # Mirror URL — return empty so it doesn't add anything unexpected.
        return ({}, "empty")

    monkeypatch.setattr(celestrak, "_fetch_url_with_retry", fake_url_fetch)
    monkeypatch.setattr(celestrak, "_fetch_url", fake_url_fetch)

    fut: asyncio.Future = asyncio.get_event_loop().create_future()
    await celestrak._run_celestrak_fetch(list(live), fut)  # type: ignore[attr-defined]

    status = get_cache_status()
    assert status["last_fetch_ok"] is True
    assert status["last_fetch_error"] is None
    assert status["entries"] == len(live)

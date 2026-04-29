"""Verify stack-trace-exposure fix (CodeQL py/stack-trace-exposure).

Exception details from CelesTrak fetch failures must never flow into
client-facing responses. The public contract is a stable, opaque set of
error codes (see celestrak.ERR_*).
"""

import pytest
from unittest.mock import patch

import celestrak
from celestrak import (
    ERR_TIMEOUT, ERR_NETWORK, ERR_UPSTREAM, ERR_EMPTY,
    get_tle_by_source, _classify_network_error, invalidate_cache,
)
from satellites import RUSSIAN_CUBESATS, is_operational


SAFE_CODES = {ERR_TIMEOUT, ERR_NETWORK, ERR_UPSTREAM, ERR_EMPTY}


@pytest.fixture(autouse=True)
def _reset_cache():
    invalidate_cache()
    yield
    invalidate_cache()


def _has_raw_exception_marker(value) -> bool:
    """A naive guard: real exception strings from Python typically
    include a class name + colon ("RuntimeError: ..."), file paths,
    or line-number markers. None of these should appear in a response."""
    if not isinstance(value, str):
        return False
    bad_markers = [
        "Traceback", "File \"", "line ",
        "Error:", "Exception:", "RuntimeError", "ValueError",
        "<class ", "object at 0x",
    ]
    return any(m in value for m in bad_markers)


@pytest.mark.asyncio
async def test_get_tle_by_source_returns_safe_code_on_failure():
    async def _boom(*_args, **_kwargs):
        raise RuntimeError("secret internal path /etc/config/at line 42")

    with patch.object(celestrak, "fetch_celestrak_tle", _boom):
        payload = await get_tle_by_source("celestrak")

    meta = payload["meta"]
    # Sanitised error code, not a raw message
    assert meta["error"] in SAFE_CODES
    assert not _has_raw_exception_marker(meta["error"])
    assert "secret internal path" not in (meta["error"] or "")
    assert "/etc/config" not in (meta["error"] or "")


@pytest.mark.asyncio
async def test_classify_network_error_returns_safe_codes():
    for exc in [
        RuntimeError("oh no /home/user/secret"),
        ValueError("kaboom"),
        Exception("anything"),
    ]:
        code = _classify_network_error(exc)
        assert code in SAFE_CODES
        assert not _has_raw_exception_marker(code)


@pytest.mark.asyncio
async def test_get_tle_embedded_has_no_error_surface():
    payload = await get_tle_by_source("embedded")
    meta = payload["meta"]
    # Embedded path never touches CelesTrak and must have no error
    assert meta["error"] is None


@pytest.mark.asyncio
async def test_partial_celestrak_uses_contract_source_name():
    live_sat = next(s for s in RUSSIAN_CUBESATS if is_operational(s.status))

    async def _partial_live(*_args, **_kwargs):
        return {live_sat.norad_id: (live_sat.tle_line1, live_sat.tle_line2)}

    with patch.object(celestrak, "fetch_celestrak_tle", _partial_live):
        payload = await get_tle_by_source("celestrak")

    meta = payload["meta"]
    assert meta["effective_source"] == "celestrak_partial"
    assert meta["live_count"] == 1
    assert meta["fallback_count"] == meta["total"] - 1


@pytest.mark.asyncio
async def test_cache_status_error_field_is_safe_or_none():
    from celestrak import get_cache_status
    status = get_cache_status()
    err = status.get("last_fetch_error")
    # On a fresh state it is None; on failure it is one of SAFE_CODES.
    assert err is None or err in SAFE_CODES

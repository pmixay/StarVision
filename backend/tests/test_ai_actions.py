"""Tests for StarAI action validation."""

import pytest

from ai_assistant import (
    OPENROUTER_MODEL,
    ask_starai,
    validate_actions,
    _ask_openrouter,
    _get_openrouter_model,
)


def test_accepts_valid_actions():
    actions = [
        {"type": "focus_satellite", "norad_id": 46493},
        {"type": "set_time_speed", "speed": 50},
        {"type": "toggle_orbits", "visible": True},
        {"type": "reset_view"},
    ]
    accepted, rejected = validate_actions(actions)
    assert len(accepted) == 4
    assert rejected == []


def test_rejects_archival_norad():
    actions = [{"type": "focus_satellite", "norad_id": 53385}]  # Geoscan-Edelveis (deorbited)
    accepted, rejected = validate_actions(actions)
    assert accepted == []
    assert rejected and "archival" in rejected[0]


def test_rejects_unknown_norad():
    actions = [{"type": "focus_satellite", "norad_id": 99999}]
    accepted, rejected = validate_actions(actions)
    assert accepted == []
    assert rejected


def test_rejects_unknown_action():
    actions = [{"type": "launch_rocket"}]
    accepted, rejected = validate_actions(actions)
    assert accepted == []
    assert rejected and "unknown action" in rejected[0]


def test_clamps_out_of_range_speed():
    accepted, _ = validate_actions([{"type": "set_time_speed", "speed": 999}])
    assert accepted == [{"type": "set_time_speed", "speed": 200}]
    accepted, _ = validate_actions([{"type": "set_time_speed", "speed": 0}])
    assert accepted == [{"type": "set_time_speed", "speed": 1}]


def test_clamps_satellite_count():
    accepted, _ = validate_actions([{"type": "set_satellite_count", "count": 100}])
    assert accepted == [{"type": "set_satellite_count", "count": 15}]
    accepted, _ = validate_actions([{"type": "set_satellite_count", "count": 1}])
    assert accepted == [{"type": "set_satellite_count", "count": 3}]


def test_rejects_unknown_constellation():
    accepted, rejected = validate_actions([
        {"type": "highlight_constellation", "name": "Starlink"}
    ])
    assert accepted == []
    assert rejected


def test_bool_type_enforced_for_toggles():
    accepted, rejected = validate_actions([
        {"type": "toggle_links", "visible": "yes"}
    ])
    assert accepted == []
    assert rejected


def test_orbit_altitude_zero_preserved():
    accepted, _ = validate_actions([{"type": "set_orbit_altitude", "altitude_km": 0}])
    assert accepted == [{"type": "set_orbit_altitude", "altitude_km": 0}]


def test_orbit_altitude_clamped():
    accepted, _ = validate_actions([{"type": "set_orbit_altitude", "altitude_km": 100}])
    # Below min 400 with alt > 0 → clamped to 400
    assert accepted == [{"type": "set_orbit_altitude", "altitude_km": 400}]


def test_caps_max_actions():
    actions = [{"type": "reset_view"}] * 20
    accepted, rejected = validate_actions(actions)
    assert len(accepted) == 8
    assert rejected and "dropped" in rejected[-1]


def test_non_list_input():
    accepted, rejected = validate_actions("not a list")  # type: ignore[arg-type]
    assert accepted == []
    assert rejected


def test_openrouter_model_is_fixed(monkeypatch):
    monkeypatch.setenv("OPENROUTER_DEFAULT_MODEL", "client/override")

    assert OPENROUTER_MODEL == "openai/gpt-oss-120b"
    assert _get_openrouter_model() == "openai/gpt-oss-120b"
    assert _get_openrouter_model("another/model") == "openai/gpt-oss-120b"


@pytest.mark.asyncio
async def test_openrouter_request_payload_uses_fixed_model(monkeypatch):
    captured = {}

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"choices": [{"message": {"content": '{"message":"ok","actions":[]}'}}]}

    class FakeAsyncClient:
        def __init__(self, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, _exc_type, _exc, _tb):
            return False

        async def post(self, url, headers=None, json=None):
            captured["url"] = url
            captured["headers"] = headers
            captured["json"] = json
            return FakeResponse()

    monkeypatch.setattr("ai_assistant.httpx.AsyncClient", FakeAsyncClient)

    result = await _ask_openrouter("hello", [], "ru", "server-key", "attempted/override")

    assert captured["headers"]["Authorization"] == "Bearer server-key"
    assert captured["json"]["model"] == "openai/gpt-oss-120b"
    assert result["source"] == "openrouter"


@pytest.mark.asyncio
async def test_ask_starai_prefers_server_openrouter_key(monkeypatch):
    calls = []

    async def fake_openrouter(user_message, history, lang, api_key, model):
        calls.append((user_message, history, lang, api_key, model))
        return {
            "message": "ok",
            "actions": [],
            "rejected_actions": [],
            "source": "openrouter",
        }

    async def fail_anthropic(*_args, **_kwargs):
        raise AssertionError("Anthropic should not be called when OpenRouter is configured")

    history = [{"role": "assistant", "content": "previous"}]
    monkeypatch.setenv("OPENROUTER_API_KEY", "server-openrouter-key")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "server-anthropic-key")
    monkeypatch.setattr("ai_assistant._ask_openrouter", fake_openrouter)
    monkeypatch.setattr("ai_assistant._ask_anthropic", fail_anthropic)

    result = await ask_starai("hello", history, lang="en")

    assert result["source"] == "openrouter"
    assert calls == [("hello", history, "en", "server-openrouter-key", None)]


@pytest.mark.asyncio
async def test_ask_starai_falls_back_offline_without_server_keys(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    result = await ask_starai("hello", [], lang="en")

    assert result["source"] == "offline"
    assert result["message"]

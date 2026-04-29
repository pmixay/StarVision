"""Tests for main.py — FastAPI endpoints."""

import pytest
from httpx import AsyncClient, ASGITransport

from main import app


@pytest.fixture
def transport():
    return ASGITransport(app=app)


@pytest.fixture
async def client(transport):
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
async def test_root(client):
    resp = await client.get("/")
    assert resp.status_code == 200
    data = resp.json()
    assert data["project"] == "StarVision"
    assert "version" in data


@pytest.mark.asyncio
async def test_list_satellites(client):
    resp = await client.get("/api/satellites")
    assert resp.status_code == 200
    data = resp.json()
    assert "satellites" in data
    # Catalog cap is 15 with no archival entries; see test_satellites.py
    assert data["count"] == 15
    assert len(data["satellites"]) == 15
    assert data["operational_count"] == 15
    assert data["archive_count"] == 0
    for sat in data["satellites"]:
        assert "operational" in sat
        assert sat["operational"] == (sat["status"] == "active")


@pytest.mark.asyncio
async def test_health(client):
    resp = await client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] in ("ok", "degraded")
    assert "tle_cache" in data


@pytest.mark.asyncio
async def test_tle_status(client):
    resp = await client.get("/api/tle/status")
    assert resp.status_code == 200
    data = resp.json()
    assert "entries" in data
    assert "cache_ttl_sec" in data


@pytest.mark.asyncio
async def test_get_satellite_found(client):
    resp = await client.get("/api/satellites/46493")
    assert resp.status_code == 200
    data = resp.json()
    assert data["norad_id"] == 46493
    assert data["name"] == "Декарт"


@pytest.mark.asyncio
async def test_get_satellite_not_found(client):
    resp = await client.get("/api/satellites/99999")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_tle_embedded(client):
    resp = await client.get("/api/tle?source=embedded")
    assert resp.status_code == 200
    data = resp.json()
    assert data["source"] == "embedded"
    assert "tle_data" in data
    assert len(data["tle_data"]) > 0
    assert "meta" in data
    assert data["meta"]["requested_source"] == "embedded"
    assert data["meta"]["effective_source"] == "embedded"
    assert data["meta"]["fallback"] is False


@pytest.mark.asyncio
async def test_get_tle_invalid_source(client):
    resp = await client.get("/api/tle?source=invalid")
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_get_positions(client):
    resp = await client.get("/api/positions")
    assert resp.status_code == 200
    data = resp.json()
    assert "positions" in data
    assert len(data["positions"]) == 15  # all catalog entries are operational
    pos = data["positions"][0]
    assert "eci" in pos
    assert "altitude_km" in pos
    assert "meta" in data


@pytest.mark.asyncio
async def test_get_positions_with_timestamp(client):
    resp = await client.get("/api/positions?timestamp=2026-04-01T12:00:00Z")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["positions"]) > 0


@pytest.mark.asyncio
async def test_get_positions_invalid_timestamp(client):
    resp = await client.get("/api/positions?timestamp=not-a-date")
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_get_orbit_path(client):
    resp = await client.get("/api/orbit/46493?steps=10&step_sec=60")
    assert resp.status_code == 200
    data = resp.json()
    assert data["norad_id"] == 46493
    assert len(data["path"]) == 10


@pytest.mark.asyncio
async def test_get_orbit_path_not_found(client):
    resp = await client.get("/api/orbit/99999")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_all_orbit_paths_batch(client):
    """The batch endpoint must return paths for all operational satellites
    in one call — this is the whole point of the latency fix."""
    resp = await client.get("/api/orbits?steps=10&step_sec=60")
    assert resp.status_code == 200
    data = resp.json()
    assert "paths" in data
    assert "names" in data
    # Should contain at least one operational satellite, and every entry
    # should be a 10-point path.
    assert len(data["paths"]) > 0
    for nid, path in data["paths"].items():
        assert int(nid) > 0
        assert len(path) == 10
        assert {"x", "y", "z"} <= set(path[0].keys())
    # All 15 active satellites should be present in batch.
    assert len(data["paths"]) == 15


@pytest.mark.asyncio
async def test_get_orbital_elements(client):
    resp = await client.get("/api/orbital-elements/46493")
    assert resp.status_code == 200
    data = resp.json()
    assert "inclination_deg" in data
    assert "eccentricity" in data
    assert "semi_major_axis_km" in data


@pytest.mark.asyncio
async def test_get_links(client):
    resp = await client.get("/api/links?comm_range_km=2000")
    assert resp.status_code == 200
    data = resp.json()
    assert "links" in data
    assert "active_count" in data
    assert "total_pairs" in data
    assert data["comm_range_km"] == 2000.0


@pytest.mark.asyncio
async def test_get_links_range_validation(client):
    # Above max (2000)
    resp = await client.get("/api/links?comm_range_km=5000")
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_get_collisions(client):
    resp = await client.get("/api/collisions?threshold_km=100&hours_ahead=1")
    assert resp.status_code == 200
    data = resp.json()
    assert "close_approaches" in data
    assert isinstance(data["close_approaches"], list)


@pytest.mark.asyncio
async def test_get_virtual_collisions(client):
    resp = await client.get(
        "/api/collisions?mode=virtual&threshold_km=1000&hours_ahead=1&satellite_count=6&altitude_km=550&planes=3&inclination_deg=60"
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["mode"] == "virtual"
    assert data["source"] == "virtual"
    assert data["params"]["inclination_deg"] == 60.0


@pytest.mark.asyncio
async def test_get_virtual_collisions_normalizes_plane_count(client):
    resp = await client.get(
        "/api/collisions?mode=virtual&threshold_km=1000&hours_ahead=1&satellite_count=3&altitude_km=550&planes=7&inclination_deg=60"
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["params"]["planes"] == 3


@pytest.mark.asyncio
async def test_optimize_planes(client):
    resp = await client.get("/api/optimize-planes?num_satellites=12&num_planes=3&altitude_km=550")
    assert resp.status_code == 200
    data = resp.json()
    assert data["walker_notation"] == "12/3/1"
    assert len(data["planes"]) == 3


@pytest.mark.asyncio
async def test_get_config(client):
    resp = await client.get("/api/config")
    assert resp.status_code == 200
    data = resp.json()
    assert data["earth_radius_km"] == 6371.0
    assert "constellations" in data
    assert len(data["constellations"]) == 6


@pytest.mark.asyncio
async def test_starai_chat_does_not_forward_client_credentials(client, monkeypatch):
    captured = {}

    async def fake_ask_starai(user_message, conversation_history=None, lang="ru"):
        captured["user_message"] = user_message
        captured["conversation_history"] = conversation_history
        captured["lang"] = lang
        return {
            "message": "ok",
            "actions": [],
            "rejected_actions": [],
            "source": "test",
        }

    monkeypatch.setattr("main.ask_starai", fake_ask_starai)
    resp = await client.post(
        "/api/starai/chat",
        json={
            "message": "hello",
            "history": [{"role": "assistant", "content": "previous"}],
            "lang": "en",
            "provider": "openrouter",
            "api_key": "client-key-must-not-be-forwarded",
            "model": "client/model",
        },
    )

    assert resp.status_code == 200
    assert resp.json()["source"] == "test"
    assert captured == {
        "user_message": "hello",
        "conversation_history": [{"role": "assistant", "content": "previous"}],
        "lang": "en",
    }

"""Regression tests for the operational filter.

The catalog currently ships only operational spacecraft, but the architecture
must keep filtering archival entries out of every live propagation path so a
future deorbit can be marked with `status="deorbited"` without breaking the
3D scene, the ISL counter, or the link API. We synthesise a deorbited
satellite at runtime to verify the filter still bites.
"""

import pytest
from httpx import AsyncClient, ASGITransport

import main
import orbital
import satellites
from satellites import RUSSIAN_CUBESATS, SatelliteInfo


SYNTHETIC_NORAD = 99001
SYNTHETIC_TLE_LINE1 = "1 99001U 23091XX  26091.50000000  .00000280  00000-0  18000-4 0  9994"
SYNTHETIC_TLE_LINE2 = "2 99001  97.6000  60.0000 0010000  90.0000 270.0000 15.10000000 15006"


@pytest.fixture(autouse=True)
def archival_entry():
    """Inject a deorbited satellite into the live catalog for the duration
    of the test, then restore. We mutate the list in place because every
    module imports it by reference."""
    archival = SatelliteInfo(
        norad_id=SYNTHETIC_NORAD,
        name="Test-Archival",
        constellation="УниверСат",
        purpose="regression test",
        mass_kg=1.0,
        form_factor="3U",
        launch_date="2023-06-27",
        status="deorbited",
        tle_line1=SYNTHETIC_TLE_LINE1,
        tle_line2=SYNTHETIC_TLE_LINE2,
        archive_date="2025-01-01",
    )
    RUSSIAN_CUBESATS.append(archival)
    satellites._BY_NORAD[SYNTHETIC_NORAD] = archival
    # /positions caches an operational set on first hit; reset it so the
    # synthetic catalog change is visible to this test.
    main._OPERATIONAL_NORADS_CACHE = None
    try:
        yield archival
    finally:
        RUSSIAN_CUBESATS.remove(archival)
        satellites._BY_NORAD.pop(SYNTHETIC_NORAD, None)
        main._OPERATIONAL_NORADS_CACHE = None


@pytest.fixture
def transport():
    return ASGITransport(app=main.app)


@pytest.fixture
async def client(transport):
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


def test_propagate_all_excludes_archival():
    results = orbital.propagate_all()
    ids = {r["norad_id"] for r in results}
    assert SYNTHETIC_NORAD not in ids


@pytest.mark.asyncio
async def test_positions_exclude_archival(client):
    resp = await client.get("/api/positions")
    assert resp.status_code == 200
    ids = {p["norad_id"] for p in resp.json()["positions"]}
    assert SYNTHETIC_NORAD not in ids


@pytest.mark.asyncio
async def test_tle_embedded_excludes_archival(client):
    resp = await client.get("/api/tle?source=embedded")
    assert resp.status_code == 200
    body = resp.json()
    ids = {t["norad_id"] for t in body["tle_data"]}
    assert SYNTHETIC_NORAD not in ids
    meta = body["meta"]
    assert meta["operational_only"] is True
    assert meta["effective_source"] == "embedded"
    assert meta["total"] == len(body["tle_data"])


@pytest.mark.asyncio
async def test_orbit_for_archival_rejected_with_409(client):
    resp = await client.get(f"/api/orbit/{SYNTHETIC_NORAD}")
    assert resp.status_code == 409
    detail = resp.json()["detail"].lower()
    assert "archival" in detail or "deorbited" in detail


@pytest.mark.asyncio
async def test_orbital_elements_for_archival_rejected_with_409(client):
    resp = await client.get(f"/api/orbital-elements/{SYNTHETIC_NORAD}")
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_orbit_for_live_sat_still_works(client):
    live_id = next(s.norad_id for s in RUSSIAN_CUBESATS if s.status == "active")
    resp = await client.get(f"/api/orbit/{live_id}?steps=10&step_sec=60")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_links_exclude_archival(client):
    resp = await client.get("/api/links?comm_range_km=2000")
    assert resp.status_code == 200
    data = resp.json()
    ids_in_links = set()
    for lnk in data["links"]:
        ids_in_links.add(lnk["norad_id_1"])
        ids_in_links.add(lnk["norad_id_2"])
    assert SYNTHETIC_NORAD not in ids_in_links


@pytest.mark.asyncio
async def test_health_reports_operational_counts(client):
    resp = await client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["catalog"]["total"] == len(RUSSIAN_CUBESATS)
    assert data["catalog"]["archival"] >= 1  # synthetic entry guarantees this
    assert data["catalog"]["operational"] + data["catalog"]["archival"] == data["catalog"]["total"]


@pytest.mark.asyncio
async def test_tle_meta_shape(client):
    resp = await client.get("/api/tle?source=embedded")
    data = resp.json()
    meta = data["meta"]
    for key in ("requested_source", "effective_source", "operational_only",
                "fetched_at", "cache_age_sec", "network_error",
                "fallback_count", "live_count", "total"):
        assert key in meta, f"meta missing {key}"
    assert meta["requested_source"] == "embedded"
    assert meta["network_error"] is False

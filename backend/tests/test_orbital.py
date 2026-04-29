"""Tests for orbital.py — SGP4 propagation and orbital mechanics."""

import math
from datetime import datetime, timezone

from orbital import (
    EARTH_RADIUS_KM,
    _virtual_eci,
    eci_to_geodetic,
    get_orbital_elements,
    optimize_plane_distribution,
    predict_collisions,
    predict_virtual_collisions,
    propagate_all,
    propagate_orbit_path,
    propagate_satellite,
)
from satellites import RUSSIAN_CUBESATS, get_satellite_by_id

# Fixed time for reproducible tests
TEST_TIME = datetime(2026, 4, 1, 12, 0, 0, tzinfo=timezone.utc)


class TestPropagateSatellite:
    """Test single-satellite SGP4 propagation."""

    def test_returns_valid_position(self):
        sat = get_satellite_by_id(46493)  # Dekart
        result = propagate_satellite(sat, TEST_TIME)
        assert "error" not in result
        assert "eci" in result
        assert "velocity" in result
        assert result["norad_id"] == 46493

    def test_altitude_in_leo_range(self):
        sat = get_satellite_by_id(46493)
        result = propagate_satellite(sat, TEST_TIME)
        alt = result["altitude_km"]
        # LEO: 200–2000 km
        assert 200 < alt < 2000, f"Altitude {alt} km out of LEO range"

    def test_speed_is_reasonable(self):
        sat = get_satellite_by_id(46493)
        result = propagate_satellite(sat, TEST_TIME)
        speed = result["speed_km_s"]
        # LEO orbital speed: ~7.0–8.0 km/s
        assert 6.5 < speed < 8.5, f"Speed {speed} km/s out of expected range"

    def test_period_is_reasonable(self):
        sat = get_satellite_by_id(46493)
        result = propagate_satellite(sat, TEST_TIME)
        period = result["period_min"]
        # LEO period: ~88–130 min
        assert 85 < period < 135, f"Period {period} min out of expected range"

    def test_lat_lon_ranges(self):
        sat = get_satellite_by_id(46493)
        result = propagate_satellite(sat, TEST_TIME)
        assert -90 <= result["lat"] <= 90
        assert -180 <= result["lon"] <= 180

    def test_eci_coordinates_nonzero(self):
        sat = get_satellite_by_id(46493)
        result = propagate_satellite(sat, TEST_TIME)
        eci = result["eci"]
        r = math.sqrt(eci["x"] ** 2 + eci["y"] ** 2 + eci["z"] ** 2)
        # Radius should be Earth radius + altitude
        assert r > EARTH_RADIUS_KM
        assert r < EARTH_RADIUS_KM + 2000


class TestPropagateAll:
    """Test batch propagation."""

    def test_propagates_only_operational_satellites(self):
        results = propagate_all(TEST_TIME)
        # Archival satellites must be skipped — their TLE is stale.
        operational = sum(
            1 for s in RUSSIAN_CUBESATS if s.status == "active" and s.tle_line1 and s.tle_line2
        )
        assert len(results) == operational
        # Explicit check: deorbited satellite is never propagated
        assert 53385 not in {r["norad_id"] for r in results}

    def test_each_result_has_required_fields(self):
        results = propagate_all(TEST_TIME)
        for r in results:
            assert "norad_id" in r
            assert "name" in r
            assert "eci" in r
            assert "altitude_km" in r

    def test_no_duplicate_norad_ids(self):
        results = propagate_all(TEST_TIME)
        ids = [r["norad_id"] for r in results]
        assert len(ids) == len(set(ids))


class TestPropagateOrbitPath:
    """Test orbital track generation."""

    def test_returns_correct_number_of_points(self):
        sat = get_satellite_by_id(46493)
        path = propagate_orbit_path(sat, TEST_TIME, steps=60, step_sec=60.0)
        assert len(path) == 60

    def test_points_have_xyz(self):
        sat = get_satellite_by_id(46493)
        path = propagate_orbit_path(sat, TEST_TIME, steps=10)
        for point in path:
            assert "x" in point
            assert "y" in point
            assert "z" in point

    def test_path_forms_orbit(self):
        """Orbit points should be at roughly constant radius (circular orbit)."""
        sat = get_satellite_by_id(46493)
        path = propagate_orbit_path(sat, TEST_TIME, steps=120, step_sec=60.0)
        radii = [math.sqrt(p["x"] ** 2 + p["y"] ** 2 + p["z"] ** 2) for p in path]
        avg_r = sum(radii) / len(radii)
        for r in radii:
            # Low eccentricity orbits: radius variation < 2%
            assert abs(r - avg_r) / avg_r < 0.02


class TestEciToGeodetic:
    """Test coordinate conversion."""

    def test_north_pole(self):
        # Point directly above north pole
        jd = 2460000.5  # arbitrary Julian date
        lat, lon = eci_to_geodetic(0, 0, 7000, jd)
        assert abs(lat - 90.0) < 0.01

    def test_equator(self):
        jd = 2460000.5
        lat, _ = eci_to_geodetic(7000, 0, 0, jd)
        assert abs(lat) < 0.01  # should be near equator

    def test_south_pole(self):
        jd = 2460000.5
        lat, _ = eci_to_geodetic(0, 0, -7000, jd)
        assert abs(lat + 90.0) < 0.01


class TestPredictCollisions:
    """Test collision prediction."""

    def test_returns_list(self):
        result = predict_collisions(threshold_km=5000, hours_ahead=1.0)
        assert isinstance(result, list)

    def test_result_structure(self):
        result = predict_collisions(threshold_km=50000, hours_ahead=1.0)
        if len(result) > 0:
            item = result[0]
            assert "norad_id_1" in item
            assert "norad_id_2" in item
            assert "min_distance_km" in item
            assert "risk_level" in item
            assert item["risk_level"] in ("critical", "warning", "safe")

    def test_sorted_by_distance(self):
        result = predict_collisions(threshold_km=50000, hours_ahead=1.0)
        if len(result) > 1:
            distances = [r["min_distance_km"] for r in result]
            assert distances == sorted(distances)


class TestPredictVirtualCollisions:
    def test_returns_list(self):
        result = predict_virtual_collisions(6, 550.0, 3, 55.0, threshold_km=5000, hours_ahead=1.0)
        assert isinstance(result, list)

    def test_result_uses_virtual_ids(self):
        result = predict_virtual_collisions(6, 550.0, 3, 55.0, threshold_km=50000, hours_ahead=0.5)
        if result:
            assert result[0]["norad_id_1"] >= 90000
            assert result[0]["norad_id_2"] >= 90000

    def test_uneven_plane_layout_matches_optimizer(self):
        result = optimize_plane_distribution(10, 3, 550.0, 0.0)
        expected_angles = {}
        for plane in result["planes"]:
            for sat in plane["satellites"]:
                expected_angles[sat["index"]] = (
                    plane["raan_deg"] + sat["mean_anomaly_deg"]
                ) % 360.0

        for idx in range(10):
            x, y, _ = _virtual_eci(idx, 10, 550.0, 0.0, 3, 0.0)
            angle = (math.degrees(math.atan2(y, x)) + 360.0) % 360.0
            assert abs(angle - expected_angles[idx]) < 1e-6


class TestOptimizePlaneDistribution:
    """Test Walker constellation generation."""

    def test_basic_output(self):
        result = optimize_plane_distribution(12, 3, 550.0, 55.0)
        assert result["walker_notation"] == "12/3/1"
        assert result["total_satellites"] == 12
        assert result["num_planes"] == 3
        assert result["sats_per_plane"] == 4

    def test_orbital_period(self):
        result = optimize_plane_distribution(12, 3, 550.0, 55.0)
        # At 550 km: period ~ 96 min
        assert 90 < result["orbital_period_min"] < 100

    def test_velocity(self):
        result = optimize_plane_distribution(12, 3, 550.0, 55.0)
        # At 550 km: velocity ~ 7.6 km/s
        assert 7.0 < result["velocity_km_s"] < 8.0

    def test_planes_structure(self):
        result = optimize_plane_distribution(12, 3)
        planes = result["planes"]
        assert len(planes) == 3
        total_sats = sum(p["satellites_count"] for p in planes)
        assert total_sats == 12

    def test_raan_spacing(self):
        result = optimize_plane_distribution(12, 3)
        planes = result["planes"]
        # RAAN should be evenly spaced: 0, 120, 240
        assert planes[0]["raan_deg"] == 0.0
        assert planes[1]["raan_deg"] == 120.0
        assert planes[2]["raan_deg"] == 240.0

    def test_single_plane(self):
        result = optimize_plane_distribution(5, 1, 600.0)
        assert result["num_planes"] == 1
        assert result["planes"][0]["satellites_count"] == 5

    def test_uneven_distribution(self):
        result = optimize_plane_distribution(7, 3)
        planes = result["planes"]
        counts = [p["satellites_count"] for p in planes]
        assert sum(counts) == 7
        # Remainder 1: first plane gets extra satellite
        assert counts[0] == 3
        assert counts[1] == 2
        assert counts[2] == 2


class TestGetOrbitalElements:
    """Test Keplerian element extraction."""

    def test_returns_elements(self):
        sat = get_satellite_by_id(46493)
        result = get_orbital_elements(sat)
        assert "inclination_deg" in result
        assert "raan_deg" in result
        assert "eccentricity" in result
        assert "semi_major_axis_km" in result

    def test_inclination_range(self):
        sat = get_satellite_by_id(46493)
        result = get_orbital_elements(sat)
        # Sun-synchronous: ~97.4 degrees
        assert 95 < result["inclination_deg"] < 100

    def test_eccentricity_low(self):
        sat = get_satellite_by_id(46493)
        result = get_orbital_elements(sat)
        # LEO near-circular: e < 0.05
        assert result["eccentricity"] < 0.05

    def test_altitude_matches_leo(self):
        sat = get_satellite_by_id(46493)
        result = get_orbital_elements(sat)
        assert 200 < result["altitude_approx_km"] < 2000

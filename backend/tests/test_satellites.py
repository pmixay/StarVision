"""Tests for satellites.py — Russian CubeSat catalog."""

from satellites import (
    RUSSIAN_CUBESATS,
    SatelliteInfo,
    get_all_satellites,
    get_satellite_by_id,
    get_tle_data,
)

EXPECTED_COUNT = 15


class TestSatelliteCatalog:
    """Catalog integrity checks."""

    def test_catalog_size(self):
        assert len(RUSSIAN_CUBESATS) == EXPECTED_COUNT

    def test_all_entries_are_satellite_info(self):
        for sat in RUSSIAN_CUBESATS:
            assert isinstance(sat, SatelliteInfo)

    def test_norad_ids_are_unique(self):
        ids = [s.norad_id for s in RUSSIAN_CUBESATS]
        assert len(ids) == len(set(ids))

    def test_all_have_required_fields(self):
        for sat in RUSSIAN_CUBESATS:
            assert sat.norad_id > 0
            assert len(sat.name) > 0
            assert len(sat.constellation) > 0
            assert sat.mass_kg > 0
            assert sat.form_factor in ("1U", "1.5U", "3U", "6U")
            assert sat.status in ("active", "inactive", "deorbited")

    def test_constellations_are_known(self):
        known = {"УниверСат", "МГТУ Баумана", "SPUTNIX", "Геоскан", "НИИЯФ МГУ", "Space-Pi"}
        for sat in RUSSIAN_CUBESATS:
            assert (
                sat.constellation in known
            ), f"{sat.name} has unknown constellation: {sat.constellation}"

    def test_active_satellites_have_tle(self):
        for sat in RUSSIAN_CUBESATS:
            if sat.status == "active":
                assert sat.tle_line1.startswith("1 "), f"{sat.name}: bad TLE line 1"
                assert sat.tle_line2.startswith("2 "), f"{sat.name}: bad TLE line 2"

    def test_tle_line_lengths(self):
        for sat in RUSSIAN_CUBESATS:
            if sat.tle_line1:
                assert (
                    len(sat.tle_line1) == 69
                ), f"{sat.name}: TLE line 1 length = {len(sat.tle_line1)}"
                assert (
                    len(sat.tle_line2) == 69
                ), f"{sat.name}: TLE line 2 length = {len(sat.tle_line2)}"

    def test_no_deorbited_satellites(self):
        # Per project policy the catalog must not ship spacecraft that
        # already re-entered the atmosphere — their TLEs are stale and
        # downstream propagation would yield nonsense.
        deorbited = [s for s in RUSSIAN_CUBESATS if s.status == "deorbited"]
        assert deorbited == []

    def test_all_satellites_active(self):
        # Companion of the test above: the live catalog must be 100% active.
        for sat in RUSSIAN_CUBESATS:
            assert sat.status == "active"


class TestGetAllSatellites:
    def test_returns_list_of_dicts(self):
        result = get_all_satellites()
        assert isinstance(result, list)
        assert len(result) == EXPECTED_COUNT
        for item in result:
            assert isinstance(item, dict)
            assert "norad_id" in item
            assert "name" in item
            assert "constellation" in item

    def test_dict_keys(self):
        item = get_all_satellites()[0]
        expected_keys = {
            "norad_id",
            "name",
            "constellation",
            "purpose",
            "mass_kg",
            "form_factor",
            "launch_date",
            "status",
            "operational",
            "archive_date",
            "description",
        }
        assert set(item.keys()) == expected_keys

    def test_operational_flag(self):
        items = get_all_satellites()
        for item in items:
            assert item["operational"] == (item["status"] == "active")
        # All catalog entries must be operational.
        archival = [i for i in items if not i["operational"]]
        assert archival == []


class TestGetSatelliteById:
    def test_find_existing(self):
        sat = get_satellite_by_id(46493)
        assert sat is not None
        assert sat.name == "Декарт"
        assert sat.constellation == "УниверСат"

    def test_find_nonexistent(self):
        assert get_satellite_by_id(99999) is None

    def test_find_new_additions(self):
        # Vizard-ion (replaces deorbited Geoscan-Edelveis on the Geoscan platform)
        v = get_satellite_by_id(61749)
        assert v is not None
        assert v.constellation == "Геоскан"
        assert v.status == "active"


class TestGetTleData:
    def test_returns_all_active(self):
        tle_list = get_tle_data()
        assert len(tle_list) == EXPECTED_COUNT

    def test_active_satellites_present(self):
        tle_list = get_tle_data()
        norad_ids = [item["norad_id"] for item in tle_list]
        assert 46493 in norad_ids  # Dekart
        assert 46490 in norad_ids  # Yarilo-1
        assert 61749 in norad_ids  # Vizard-ion

    def test_tle_data_shape(self):
        tle_list = get_tle_data()
        for item in tle_list:
            assert "norad_id" in item
            assert "name" in item
            assert "constellation" in item
            assert "tle_line1" in item
            assert "tle_line2" in item
            assert item["tle_line1"].startswith("1 ")
            assert item["tle_line2"].startswith("2 ")

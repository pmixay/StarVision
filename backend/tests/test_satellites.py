"""Tests for satellites.py — Russian CubeSat catalog."""

from satellites import (
    RUSSIAN_CUBESATS,
    SatelliteInfo,
    get_all_satellites,
    get_operational_satellites,
    get_satellite_by_id,
    get_tle_data,
)

# 15 operational + 3 archival (Yarilo-1 / CubeSX-HSE / Yarilo-3 all
# de-orbited or no longer transmitting in 2025) = 18 catalog entries.
EXPECTED_OPERATIONAL_COUNT = 15
EXPECTED_ARCHIVAL_COUNT = 3
EXPECTED_TOTAL_COUNT = EXPECTED_OPERATIONAL_COUNT + EXPECTED_ARCHIVAL_COUNT
ARCHIVAL_NORAD_IDS = {46490, 47952, 57198}


class TestSatelliteCatalog:
    """Catalog integrity checks."""

    def test_catalog_size(self):
        assert len(RUSSIAN_CUBESATS) == EXPECTED_TOTAL_COUNT

    def test_operational_size(self):
        operational = [s for s in RUSSIAN_CUBESATS if s.status == "active"]
        assert len(operational) == EXPECTED_OPERATIONAL_COUNT

    def test_archival_size(self):
        archival = [s for s in RUSSIAN_CUBESATS if s.status != "active"]
        assert len(archival) == EXPECTED_ARCHIVAL_COUNT
        assert {s.norad_id for s in archival} == ARCHIVAL_NORAD_IDS

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

    def test_archival_satellites_have_no_tle(self):
        # Archival catalog entries must not carry a TLE — propagating a
        # stale TLE for a re-entered spacecraft yields coordinates that
        # look real but aren't.
        for sat in RUSSIAN_CUBESATS:
            if sat.status != "active":
                assert sat.tle_line1 == ""
                assert sat.tle_line2 == ""

    def test_archival_satellites_have_archive_date(self):
        for sat in RUSSIAN_CUBESATS:
            if sat.status != "active":
                assert sat.archive_date, f"{sat.name}: archive_date missing"

    def test_tle_line_lengths(self):
        for sat in RUSSIAN_CUBESATS:
            if sat.tle_line1:
                assert (
                    len(sat.tle_line1) == 69
                ), f"{sat.name}: TLE line 1 length = {len(sat.tle_line1)}"
                assert (
                    len(sat.tle_line2) == 69
                ), f"{sat.name}: TLE line 2 length = {len(sat.tle_line2)}"


class TestGetAllSatellites:
    def test_returns_list_of_dicts(self):
        result = get_all_satellites()
        assert isinstance(result, list)
        assert len(result) == EXPECTED_TOTAL_COUNT
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
        archival = [i for i in items if not i["operational"]]
        assert {i["norad_id"] for i in archival} == ARCHIVAL_NORAD_IDS

    def test_archival_helper_excludes_them(self):
        operational = get_operational_satellites()
        for sat in operational:
            assert sat.norad_id not in ARCHIVAL_NORAD_IDS


class TestGetSatelliteById:
    def test_find_existing(self):
        sat = get_satellite_by_id(46493)
        assert sat is not None
        assert sat.name == "Декарт"
        assert sat.constellation == "УниверСат"

    def test_find_nonexistent(self):
        assert get_satellite_by_id(99999) is None

    def test_find_new_additions(self):
        # Replacements added when the 2025 deorbits forced a catalog rev.
        for norad_id, expected_constellation in (
            (57180, "НИИЯФ МГУ"),  # Monitor-3
            (57182, "НИИЯФ МГУ"),  # Monitor-4
            (61772, "SPUTNIX"),  # HyperView 1G
        ):
            v = get_satellite_by_id(norad_id)
            assert v is not None, f"missing replacement {norad_id}"
            assert v.status == "active"
            assert v.constellation == expected_constellation

    def test_archival_entries_present(self):
        for norad_id in ARCHIVAL_NORAD_IDS:
            sat = get_satellite_by_id(norad_id)
            assert sat is not None
            assert sat.status != "active"


class TestGetTleData:
    def test_returns_all_operational(self):
        tle_list = get_tle_data()
        assert len(tle_list) == EXPECTED_OPERATIONAL_COUNT

    def test_archival_satellites_excluded(self):
        norad_ids = {item["norad_id"] for item in get_tle_data()}
        for archival in ARCHIVAL_NORAD_IDS:
            assert archival not in norad_ids

    def test_operational_satellites_present(self):
        norad_ids = {item["norad_id"] for item in get_tle_data()}
        assert 46493 in norad_ids  # Dekart
        assert 61749 in norad_ids  # Vizard-ion
        assert 57180 in norad_ids  # Monitor-3 (replacement)
        assert 61772 in norad_ids  # HyperView 1G (replacement)

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

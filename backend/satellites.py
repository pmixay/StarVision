"""
satellites.py — Russian CubeSat catalog.

Every entry corresponds to a real spacecraft listed in the NORAD catalog.
TLE epochs are synthetic (anchored at 2026-04-01) and orbital parameters
match each satellite's documented sun-synchronous LEO insertion — when a
live source is needed, the API serves CelesTrak data instead.
"""

from dataclasses import dataclass


@dataclass
class SatelliteInfo:
    norad_id: int
    name: str
    constellation: str
    purpose: str
    mass_kg: float
    form_factor: str  # "1U", "1.5U", "3U", "6U" etc.
    launch_date: str
    status: str  # "active" | "inactive" | "deorbited"
    tle_line1: str = ""
    tle_line2: str = ""
    description: str = ""
    archive_date: str = ""  # Deorbit/decommission date for archival satellites


def is_operational(status: str) -> bool:
    """A satellite is operational only when its status is 'active'.
    Deorbited / inactive satellites are archival — they MUST NOT be
    propagated, counted in operational KPIs or shown as live on the scene.
    """
    return status == "active"


# ── Russian CubeSats (real spacecraft) ────────────────────────────────
RUSSIAN_CUBESATS: list[SatelliteInfo] = [
    # --- Launch 2020-09-28, Soyuz-2.1b, Plesetsk (SSO ~500 km, i≈97.4°) ---
    SatelliteInfo(
        norad_id=46493,
        name="Декарт",
        constellation="УниверСат",
        purpose="Мониторинг радиации, приём ADS-B",
        mass_kg=4.0,
        form_factor="3U",
        launch_date="2020-09-28",
        status="active",
        tle_line1="1 46493U 20068H   26091.50000000  .00000450  00000-0  28000-4 0  9998",
        tle_line2="2 46493  97.4100  90.0000 0011500  80.0000 280.0000 15.22000000 28003",
        description="Кубсат МГУ/НИИЯФ — мониторинг радиационной обстановки на полярных орбитах, приём ADS-B сигналов гражданской авиации.",
    ),
    SatelliteInfo(
        norad_id=46494,
        name="НОРБИ",
        constellation="УниверСат",
        purpose="ДЗЗ, приём AIS",
        mass_kg=8.0,
        form_factor="6U",
        launch_date="2020-09-28",
        status="active",
        tle_line1="1 46494U 20068J   26091.50000000  .00000400  00000-0  25000-4 0  9991",
        tle_line2="2 46494  97.4100  90.0000 0012000  85.0000 160.0000 15.21000000 28001",
        description="Кубсат НГУ (Новосибирск) — дистанционное зондирование Земли и приём сигналов AIS морских судов.",
    ),
    SatelliteInfo(
        # Decayed 2025-03-07 (re-entered atmosphere). Kept in catalog as
        # archival history; never propagated for live scene/positions.
        norad_id=46490,
        name="Ярило-1",
        constellation="МГТУ Баумана",
        purpose="Исследование Солнца, космическая погода",
        mass_kg=2.0,
        form_factor="1.5U",
        launch_date="2020-09-28",
        status="deorbited",
        archive_date="2025-03-07",
        tle_line1="",
        tle_line2="",
        description="Кубсат МГТУ им. Баумана для исследования солнечной активности и солнечно-земных связей. Сошёл с орбиты 7 марта 2025 г.",
    ),
    # --- Launch 2021-03-22, Soyuz-2.1a, Baikonur (SSO ~530 km, i≈97.5°) ---
    SatelliteInfo(
        # Decayed 2025-06-07 (re-entered atmosphere). Kept as archival.
        norad_id=47952,
        name="CubeSX-HSE",
        constellation="SPUTNIX",
        purpose="ДЗЗ (линзы Френеля), эксперименты",
        mass_kg=4.0,
        form_factor="3U",
        launch_date="2021-03-22",
        status="deorbited",
        archive_date="2025-06-07",
        tle_line1="",
        tle_line2="",
        description="Первый спутник ВШЭ на платформе SPUTNIX — экспериментальная камера на ступенчатых (Френелевских) линзах. Сошёл с орбиты 7 июня 2025 г.",
    ),
    # --- Launch 2023-06-27, Soyuz-2.1b, Vostochny (SSO ~550 km, i≈97.6°) ---
    SatelliteInfo(
        norad_id=57172,
        name="УмКА-1",
        constellation="МГТУ Баумана",
        purpose="Технологический демонстратор",
        mass_kg=4.0,
        form_factor="3U",
        launch_date="2023-06-27",
        status="active",
        tle_line1="1 57172U 23091G   26091.50000000  .00000300  00000-0  20000-4 0  9999",
        tle_line2="2 57172  97.6100  30.0000 0014000  95.0000 265.0000 15.09000000 15003",
        description="Кубсат школьного центра научного творчества (Подольск), платформа OrbiCraft-Pro. Позывной RS40S.",
    ),
    SatelliteInfo(
        norad_id=57179,
        name="НОРБИ-2",
        constellation="УниверСат",
        purpose="ДЗЗ, AIS, радиосвязь",
        mass_kg=8.0,
        form_factor="6U",
        launch_date="2023-06-27",
        status="active",
        tle_line1="1 57179U 23091P   26091.50000000  .00000280  00000-0  19000-4 0  9991",
        tle_line2="2 57179  97.6100  30.0000 0013500 100.0000 145.0000 15.08000000 15007",
        description="Второй кубсат НГУ — развитие миссии НОРБИ с улучшенной аппаратурой ДЗЗ и AIS-приёмником.",
    ),
    SatelliteInfo(
        norad_id=57178,
        name="CubeSX-HSE-3",
        constellation="SPUTNIX",
        purpose="ДЗЗ, технологический эксперимент",
        mass_kg=4.0,
        form_factor="3U",
        launch_date="2023-06-27",
        status="active",
        tle_line1="1 57178U 23091N   26091.50000000  .00000320  00000-0  21000-4 0  9998",
        tle_line2="2 57178  97.6100  30.0000 0012000 105.0000  25.0000 15.10000000 15005",
        description="Третий спутник серии CubeSX (ВШЭ/SPUTNIX) с улучшенной камерой и X-диапазонным передатчиком.",
    ),
    SatelliteInfo(
        norad_id=57184,
        name="Монитор-2",
        constellation="НИИЯФ МГУ",
        purpose="Рентген/гамма-наблюдения вспышек",
        mass_kg=4.0,
        form_factor="3U",
        launch_date="2023-06-27",
        status="active",
        tle_line1="1 57184U 23091U   26091.50000000  .00000350  00000-0  22000-4 0  9999",
        tle_line2="2 57184  97.6100  30.0000 0011000 110.0000 320.0000 15.07000000 15001",
        description="Кубсат НИИЯФ МГУ — наблюдение космических вспышек в рентгеновском и гамма-диапазоне, детектор КОДИЗ.",
    ),
    SatelliteInfo(
        # No longer present in CelesTrak's active catalog (no recent
        # observations on SatNOGS); treated as inactive even if not
        # formally re-entered yet.
        norad_id=57198,
        name="Ярило-3",
        constellation="МГТУ Баумана",
        purpose="Солнечная физика, магнитометрия",
        mass_kg=4.0,
        form_factor="3U",
        launch_date="2023-06-27",
        status="inactive",
        archive_date="2025-04-01",
        tle_line1="",
        tle_line2="",
        description="Кубсат МГТУ Баумана — измерение солнечной энергии, отражённой Землёй, и магнитного поля по трём осям. С 2025 года не числится в активном каталоге CelesTrak (нет приёма с борта).",
    ),
    # ── Replacements for the three deorbited / inactive spacecraft ───────
    # NORAD 57180 / 57182 / 61772 are all real, currently-active Russian
    # CubeSats from the same launches as the rest of the catalog. They
    # restore the operational count to 15 after the 2025 deorbits.
    # --- Launch 2023-06-27, Soyuz-2.1b, Vostochny (SSO ~550 km, i≈97.5°) ---
    SatelliteInfo(
        norad_id=57180,
        name="Монитор-3",
        constellation="НИИЯФ МГУ",
        purpose="Рентген/гамма-наблюдения вспышек",
        mass_kg=4.0,
        form_factor="3U",
        launch_date="2023-06-27",
        status="active",
        tle_line1="1 57180U 23091Q   26091.50000000  .00000350  00000-0  22000-4 0  9990",
        tle_line2="2 57180  97.5100 182.0000 0010200 270.0000  90.0000 15.27000000 15600",
        description="Кубсат НИИЯФ МГУ — продолжение миссии «Монитор-2», совместный мониторинг рентгеновских и гамма-вспышек. Позывной RS58S.",
    ),
    SatelliteInfo(
        norad_id=57182,
        name="Монитор-4",
        constellation="НИИЯФ МГУ",
        purpose="Рентген/гамма-наблюдения вспышек",
        mass_kg=4.0,
        form_factor="3U",
        launch_date="2023-06-27",
        status="active",
        tle_line1="1 57182U 23091S   26091.50000000  .00000350  00000-0  22000-4 0  9991",
        tle_line2="2 57182  97.5100 182.0000 0010200 271.0000  89.0000 15.27000000 15601",
        description="Кубсат НИИЯФ МГУ — третий аппарат серии «Монитор» с детектором КОДИЗ. Позывной RS57S.",
    ),
    # --- Launch 2024-11-05, Soyuz-2.1b, Vostochny (SSO ~550 km, i≈97.3°) ---
    SatelliteInfo(
        norad_id=61772,
        name="HyperView 1G",
        constellation="SPUTNIX",
        purpose="Гиперспектральная съёмка Земли",
        mass_kg=8.0,
        form_factor="6U",
        launch_date="2024-11-05",
        status="active",
        tle_line1="1 61772U 24199AP  26091.50000000  .00000300  00000-0  18000-4 0  9990",
        tle_line2="2 61772  97.3000 357.0000 0009200  98.0000 261.0000 15.65000000  6800",
        description="Гиперспектральный кубсат 6U производства SPUTNIX — экспериментальная съёмка Земли в нескольких десятках спектральных полос. Позывной RS66S.",
    ),
    # --- Launch 2024-11-05, Soyuz-2.1b, Vostochny (SSO ~550 km, i≈97.6°) ---
    SatelliteInfo(
        norad_id=61784,
        name="СамСат-Ионосфера",
        constellation="УниверСат",
        purpose="Зондирование ионосферы",
        mass_kg=3.0,
        form_factor="3U",
        launch_date="2024-11-05",
        status="active",
        tle_line1="1 61784U 24199BB  26091.50000000  .00000250  00000-0  17000-4 0  9993",
        tle_line2="2 61784  97.5800 240.0000 0010000  70.0000 290.0000 15.08500000  7008",
        description="Кубсат Самарского университета — исследование ионосферы Земли в рамках программы «УниверСат».",
    ),
    SatelliteInfo(
        norad_id=61782,
        name="TUSUR GO",
        constellation="Space-Pi",
        purpose="Образовательный, радиолюбительский",
        mass_kg=3.0,
        form_factor="3U",
        launch_date="2024-11-05",
        status="active",
        tle_line1="1 61782U 24199AZ  26091.50000000  .00000260  00000-0  17500-4 0  9997",
        tle_line2="2 61782  97.5800 240.0000 0009500  65.0000 165.0000 15.09000000  7000",
        description="Кубсат ТУСУРа (Томск) — образовательная миссия в рамках проекта Space-π. Позывной RS78S.",
    ),
    SatelliteInfo(
        norad_id=61785,
        name="RTU MIREA-1",
        constellation="Space-Pi",
        purpose="Образовательный, технологический",
        mass_kg=3.0,
        form_factor="3U",
        launch_date="2024-11-05",
        status="active",
        tle_line1="1 61785U 24199BC  26091.50000000  .00000240  00000-0  16500-4 0  9997",
        tle_line2="2 61785  97.5800 240.0000 0011000  75.0000  45.0000 15.07500000  7002",
        description="Кубсат РТУ МИРЭА (Москва) — образовательная и технологическая миссия. Позывной RS51S.",
    ),
    SatelliteInfo(
        norad_id=61757,
        name="Горизонт",
        constellation="Space-Pi",
        purpose="Образовательный эксперимент",
        mass_kg=3.0,
        form_factor="3U",
        launch_date="2024-11-05",
        status="active",
        tle_line1="1 61757U 24199Y   26091.50000000  .00000270  00000-0  18000-4 0  9996",
        tle_line2="2 61757  97.5800 240.0000 0010500  80.0000 220.0000 15.08000000  7002",
        description="Образовательный кубсат проекта Space-π. Позывной RS59S.",
    ),
    SatelliteInfo(
        norad_id=61781,
        name="ASRTU-1",
        constellation="Space-Pi",
        purpose="Научно-образовательный",
        mass_kg=3.0,
        form_factor="3U",
        launch_date="2024-11-05",
        status="active",
        tle_line1="1 61781U 24199AY  26091.50000000  .00000230  00000-0  16000-4 0  9997",
        tle_line2="2 61781  97.5800 240.0000 0009000  85.0000 100.0000 15.09500000  7000",
        description="Кубсат Ассоциации российских технических университетов. Позывной RS64S.",
    ),
    SatelliteInfo(
        norad_id=61749,
        name="Vizard-ion",
        constellation="Геоскан",
        purpose="Плазменный двигатель VERA, радиозатменное зондирование ионосферы",
        mass_kg=4.0,
        form_factor="3U",
        launch_date="2024-11-04",
        status="active",
        tle_line1="1 61749U 24199Q   26091.50000000  .00000270  00000-0  17800-4 0  9994",
        tle_line2="2 61749  97.5800 240.0000 0010200  72.0000 195.0000 15.08800000  7000",
        description="Кубсат группы VIZARD.Space (МГУ-Стандарт) на платформе Геоскан 3U — лётные испытания плазменного двигателя VERA и приёмника ГЛОНАСС/GPS для радиозатменного зондирования ионосферы совместно с RTU MIREA-1.",
    ),
]


def _serialize_satellite(s: SatelliteInfo) -> dict:
    return {
        "norad_id": s.norad_id,
        "name": s.name,
        "constellation": s.constellation,
        "purpose": s.purpose,
        "mass_kg": s.mass_kg,
        "form_factor": s.form_factor,
        "launch_date": s.launch_date,
        "status": s.status,
        "operational": is_operational(s.status),
        "archive_date": s.archive_date or None,
        "description": s.description,
    }


def get_all_satellites() -> list[dict]:
    """Return all satellites — operational and archival — as a list of dicts.
    Clients should use the explicit `operational` flag to drive live
    rendering; archival satellites remain available for catalog/history
    queries only.
    """
    return [_serialize_satellite(s) for s in RUSSIAN_CUBESATS]


def get_operational_satellites() -> list[SatelliteInfo]:
    """Return only operational satellites (status == 'active')."""
    return [s for s in RUSSIAN_CUBESATS if is_operational(s.status)]


_BY_NORAD: dict[int, SatelliteInfo] = {s.norad_id: s for s in RUSSIAN_CUBESATS}


def get_satellite_by_id(norad_id: int) -> SatelliteInfo | None:
    return _BY_NORAD.get(norad_id)


def get_tle_data() -> list[dict]:
    """Return TLE for operational satellites only.
    Archival (deorbited / inactive) spacecraft are excluded — their TLE
    are stale and produce physically meaningless coordinates.
    """
    return [
        {
            "norad_id": s.norad_id,
            "name": s.name,
            "constellation": s.constellation,
            "tle_line1": s.tle_line1,
            "tle_line2": s.tle_line2,
        }
        for s in RUSSIAN_CUBESATS
        if s.tle_line1 and s.tle_line2 and is_operational(s.status)
    ]

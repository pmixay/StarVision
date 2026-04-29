"""
satellites.py — Russian CubeSat catalog.
Real satellites with valid TLE data (synthetic epochs, realistic orbital parameters).
In production — load current TLE from CelesTrak / SpaceTrack.
"""

from dataclasses import dataclass
from typing import List, Optional

@dataclass
class SatelliteInfo:
    norad_id: int
    name: str
    constellation: str
    purpose: str
    mass_kg: float
    form_factor: str          # "1U", "1.5U", "3U", "6U" etc.
    launch_date: str
    status: str               # "active" | "inactive" | "deorbited"
    tle_line1: str = ""
    tle_line2: str = ""
    description: str = ""
    archive_date: str = ""    # Deorbit/decommission date for archival satellites


def is_operational(status: str) -> bool:
    """A satellite is operational only when its status is 'active'.
    Deorbited / inactive satellites are archival — they MUST NOT be
    propagated, counted in operational KPIs or shown as live on the scene.
    """
    return status == "active"


# ── Russian CubeSats (real spacecraft) ────────────────────────────────
RUSSIAN_CUBESATS: List[SatelliteInfo] = [

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
        description="Кубсат МГУ/НИИЯФ — мониторинг радиационной обстановки на полярных орбитах, приём ADS-B сигналов гражданской авиации."
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
        description="Кубсат НГУ (Новосибирск) — дистанционное зондирование Земли и приём сигналов AIS морских судов."
    ),
    SatelliteInfo(
        norad_id=46490,
        name="Ярило-1",
        constellation="МГТУ Баумана",
        purpose="Исследование Солнца, космическая погода",
        mass_kg=2.0,
        form_factor="1.5U",
        launch_date="2020-09-28",
        status="active",
        tle_line1="1 46490U 20068E   26091.50000000  .00000500  00000-0  30000-4 0  9994",
        tle_line2="2 46490  97.4100  90.0000 0010000  75.0000  40.0000 15.23000000 28003",
        description="Кубсат МГТУ им. Баумана для исследования солнечной активности и солнечно-земных связей."
    ),

    # --- Launch 2021-03-22, Soyuz-2.1a, Baikonur (SSO ~530 km, i≈97.5°) ---
    SatelliteInfo(
        norad_id=47952,
        name="CubeSX-HSE",
        constellation="SPUTNIX",
        purpose="ДЗЗ (линзы Френеля), эксперименты",
        mass_kg=4.0,
        form_factor="3U",
        launch_date="2021-03-22",
        status="active",
        tle_line1="1 47952U 21022W   26091.50000000  .00000380  00000-0  24000-4 0  9998",
        tle_line2="2 47952  97.4500 200.0000 0013000  90.0000 120.0000 15.15000000 26002",
        description="Первый спутник ВШЭ на платформе SPUTNIX — экспериментальная камера на ступенчатых (Френелевских) линзах."
    ),

    # --- Launch 2022-08-09, Soyuz-2.1b, Baikonur (SSO ~480 km, i≈97.4°) ---
    SatelliteInfo(
        norad_id=53385,
        name="Геоскан-Эдельвейс",
        constellation="Геоскан",
        purpose="Тест платформы, двигатель, GNSS",
        mass_kg=4.0,
        form_factor="3U",
        launch_date="2022-08-09",
        status="deorbited",
        tle_line1="1 53385U 22096R   24040.50000000  .00001200  00000-0  70000-4 0  9992",
        tle_line2="2 53385  97.4300 310.0000 0008000  60.0000 300.0000 15.25000000 85006",
        description="Первый частный наноспутник из Санкт-Петербурга (Геоскан). Лётные испытания платформы, газовый двигатель ОКБ «Факел». Сведён с орбиты 2024-02-18.",
        archive_date="2024-02-18",
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
        description="Кубсат школьного центра научного творчества (Подольск), платформа OrbiCraft-Pro. Позывной RS40S."
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
        description="Второй кубсат НГУ — развитие миссии НОРБИ с улучшенной аппаратурой ДЗЗ и AIS-приёмником."
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
        description="Третий спутник серии CubeSX (ВШЭ/SPUTNIX) с улучшенной камерой и X-диапазонным передатчиком."
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
        description="Кубсат НИИЯФ МГУ — наблюдение космических вспышек в рентгеновском и гамма-диапазоне, детектор КОДИЗ."
    ),
    SatelliteInfo(
        norad_id=57198,
        name="Ярило-3",
        constellation="МГТУ Баумана",
        purpose="Солнечная физика, магнитометрия",
        mass_kg=4.0,
        form_factor="3U",
        launch_date="2023-06-27",
        status="active",
        tle_line1="1 57198U 23091AK  26091.50000000  .00000290  00000-0  18000-4 0  9992",
        tle_line2="2 57198  97.6100  30.0000 0015000 115.0000 200.0000 15.06000000 15001",
        description="Кубсат МГТУ Баумана — измерение солнечной энергии, отражённой Землёй, и магнитного поля по трём осям."
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
        description="Кубсат Самарского университета — исследование ионосферы Земли в рамках программы «УниверСат»."
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
        description="Кубсат ТУСУРа (Томск) — образовательная миссия в рамках проекта Space-π. Позывной RS78S."
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
        description="Кубсат РТУ МИРЭА (Москва) — образовательная и технологическая миссия. Позывной RS51S."
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
        description="Образовательный кубсат проекта Space-π. Позывной RS59S."
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
        description="Кубсат Ассоциации российских технических университетов. Позывной RS64S."
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


def get_all_satellites() -> List[dict]:
    """Return all satellites — operational and archival — as a list of dicts.
    Clients should use the explicit `operational` flag to drive live
    rendering; archival satellites remain available for catalog/history
    queries only.
    """
    return [_serialize_satellite(s) for s in RUSSIAN_CUBESATS]


def get_operational_satellites() -> List[SatelliteInfo]:
    """Return only operational satellites (status == 'active')."""
    return [s for s in RUSSIAN_CUBESATS if is_operational(s.status)]


_BY_NORAD: dict[int, SatelliteInfo] = {s.norad_id: s for s in RUSSIAN_CUBESATS}


def get_satellite_by_id(norad_id: int) -> Optional[SatelliteInfo]:
    return _BY_NORAD.get(norad_id)


def get_tle_data() -> List[dict]:
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

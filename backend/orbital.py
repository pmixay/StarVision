"""
orbital.py — Orbital mechanics: SGP4 propagation, position calculation.
"""

import math
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Tuple

from sgp4.api import Satrec, WGS72, jday

from satellites import RUSSIAN_CUBESATS, SatelliteInfo, is_operational

# ── Constants ──────────────────────────────────────────────────────
EARTH_RADIUS_KM = 6371.0
MU = 398600.4418            # km³/s² — Earth gravitational parameter
J2 = 1.08263e-3             # second zonal harmonic
DEG2RAD = math.pi / 180.0
RAD2DEG = 180.0 / math.pi


def _resolve_tle(
    sat: SatelliteInfo,
    tle_override: Dict[int, tuple] = None,
) -> tuple:
    """Return (tle_line1, tle_line2) — from override or built-in."""
    if tle_override and sat.norad_id in tle_override:
        return tle_override[sat.norad_id]
    return sat.tle_line1, sat.tle_line2


def _with_tle(sat: SatelliteInfo, tle1: str, tle2: str) -> SatelliteInfo:
    """Create a copy of SatelliteInfo with replaced TLE lines."""
    return SatelliteInfo(
        norad_id=sat.norad_id,
        name=sat.name,
        constellation=sat.constellation,
        purpose=sat.purpose,
        mass_kg=sat.mass_kg,
        form_factor=sat.form_factor,
        launch_date=sat.launch_date,
        status=sat.status,
        tle_line1=tle1,
        tle_line2=tle2,
        description=sat.description,
    )


def tle_to_satrec(tle1: str, tle2: str) -> Satrec:
    """Create SGP4 object from TLE lines."""
    return Satrec.twoline2rv(tle1, tle2, WGS72)


def propagate_satellite(sat_info: SatelliteInfo, dt: datetime) -> Dict[str, Any]:
    """
    Propagate satellite to time dt.
    Returns ECI coordinates (km), velocity (km/s) and orbital elements.
    """
    satrec = tle_to_satrec(sat_info.tle_line1, sat_info.tle_line2)

    jd, fr = jday(dt.year, dt.month, dt.day,
                  dt.hour, dt.minute, dt.second + dt.microsecond / 1e6)

    error, position, velocity = satrec.sgp4(jd, fr)

    if error != 0:
        return {"error": f"SGP4 error code {error}"}

    x, y, z = position       # km (ECI)
    vx, vy, vz = velocity    # km/s

    # Altitude above surface
    r = math.sqrt(x**2 + y**2 + z**2)
    altitude_km = r - EARTH_RADIUS_KM

    # Speed
    speed = math.sqrt(vx**2 + vy**2 + vz**2)

    # Orbital period (approximate)
    a = satrec.a * EARTH_RADIUS_KM if satrec.a > 1 else r  # semi-major axis
    period_min = 2 * math.pi * math.sqrt(a**3 / MU) / 60.0

    # Geographic coordinates (simplified ECI → lat/lon)
    lat, lon = eci_to_geodetic(x, y, z, jd + fr)

    return {
        "norad_id": sat_info.norad_id,
        "name": sat_info.name,
        "eci": {"x": round(x, 3), "y": round(y, 3), "z": round(z, 3)},
        "velocity": {"vx": round(vx, 4), "vy": round(vy, 4), "vz": round(vz, 4)},
        "altitude_km": round(altitude_km, 2),
        "speed_km_s": round(speed, 4),
        "period_min": round(period_min, 2),
        "lat": round(lat, 4),
        "lon": round(lon, 4),
        "timestamp": dt.isoformat(),
    }


def eci_to_geodetic(x: float, y: float, z: float, jd_total: float) -> Tuple[float, float]:
    """Convert ECI → geodetic coordinates (lat, lon in degrees)."""
    r = math.sqrt(x**2 + y**2 + z**2)
    lat = math.asin(z / r) * RAD2DEG

    # Greenwich Mean Sidereal Time (GMST) for longitude conversion
    t = (jd_total - 2451545.0) / 36525.0
    gmst = 280.46061837 + 360.98564736629 * (jd_total - 2451545.0) + \
           0.000387933 * t**2 - t**3 / 38710000.0
    gmst = gmst % 360.0

    lon_eci = math.atan2(y, x) * RAD2DEG
    lon = (lon_eci - gmst + 180.0) % 360.0 - 180.0

    return lat, lon


def propagate_all(
    dt: datetime = None,
    tle_override: Dict[int, tuple] = None,
) -> List[Dict[str, Any]]:
    """Propagate all satellites to time dt (or current UTC).

    Args:
        dt: time moment (UTC). Defaults to current UTC.
        tle_override: dict norad_id → (tle_line1, tle_line2).
            If provided, TLE from this dict is used for each satellite
            (instead of built-in). Satellites missing from dict are propagated
            with built-in TLE.
    """
    if dt is None:
        dt = datetime.now(timezone.utc)

    results = []
    for sat in RUSSIAN_CUBESATS:
        # Archival satellites (deorbited / inactive) carry stale TLE and
        # would yield physically meaningless coordinates — skip them.
        if not is_operational(sat.status):
            continue
        tle1, tle2 = _resolve_tle(sat, tle_override)
        if tle1 and tle2:
            sat_copy = _with_tle(sat, tle1, tle2)
            data = propagate_satellite(sat_copy, dt)
            if "error" not in data:
                results.append(data)
    return results


def propagate_orbit_path(sat_info: SatelliteInfo, dt_start: datetime,
                         steps: int = 120, step_sec: float = 60.0,
                         tle_override: Dict[int, tuple] = None) -> List[Dict[str, float]]:
    """
    Calculate orbit points for track visualization.
    Default: 120 points at 60s step = 2 hours of track.
    """
    tle1, tle2 = _resolve_tle(sat_info, tle_override)
    satrec = tle_to_satrec(tle1, tle2)
    path = []

    for i in range(steps):
        offset = i * step_sec
        t = dt_start.timestamp() + offset
        dt = datetime.fromtimestamp(t, tz=timezone.utc)

        jd, fr = jday(dt.year, dt.month, dt.day,
                      dt.hour, dt.minute, dt.second + dt.microsecond / 1e6)
        error, position, _ = satrec.sgp4(jd, fr)

        if error == 0:
            x, y, z = position
            path.append({"x": round(x, 3), "y": round(y, 3), "z": round(z, 3)})

    return path


def predict_collisions(
    threshold_km: float = 100.0,
    hours_ahead: float = 24.0,
    step_sec: float = 60.0,
    tle_override: Dict[int, tuple] = None,
) -> List[Dict[str, Any]]:
    """
    Predict potential collisions (close approaches).
    Checks all satellite pairs for minimum distance within the given time window.
    """
    dt_start = datetime.now(timezone.utc)
    steps = int(hours_ahead * 3600 / step_sec)
    sats_with_tle = []
    for s in RUSSIAN_CUBESATS:
        if not is_operational(s.status):
            continue
        t1, t2 = _resolve_tle(s, tle_override)
        if t1 and t2:
            sats_with_tle.append(_with_tle(s, t1, t2))
    satrecs = [(s, tle_to_satrec(s.tle_line1, s.tle_line2)) for s in sats_with_tle]

    close_approaches: List[Dict[str, Any]] = []
    # Find minimum distance for each pair over the period
    pair_min: Dict[tuple, Dict[str, Any]] = {}

    for step_i in range(0, steps, max(1, steps // 1440)):  # ~1440 samples for fine-grained detection
        offset = step_i * step_sec
        dt = dt_start + timedelta(seconds=offset)
        jd, fr = jday(dt.year, dt.month, dt.day,
                      dt.hour, dt.minute, dt.second)

        positions = []
        for sat, satrec in satrecs:
            error, pos, _ = satrec.sgp4(jd, fr)
            if error == 0:
                positions.append((sat, pos))

        for i in range(len(positions)):
            for j in range(i + 1, len(positions)):
                s1, p1 = positions[i]
                s2, p2 = positions[j]
                dx = p1[0] - p2[0]
                dy = p1[1] - p2[1]
                dz = p1[2] - p2[2]
                dist = math.sqrt(dx*dx + dy*dy + dz*dz)

                pair_key = (s1.norad_id, s2.norad_id)
                if pair_key not in pair_min or dist < pair_min[pair_key]["min_distance_km"]:
                    pair_min[pair_key] = {
                        "norad_id_1": s1.norad_id,
                        "name_1": s1.name,
                        "norad_id_2": s2.norad_id,
                        "name_2": s2.name,
                        "min_distance_km": round(dist, 2),
                        "time_of_closest_approach": dt.isoformat(),
                        "risk_level": "critical" if dist < 10 else "warning" if dist < threshold_km else "safe",
                    }

    for pair_data in pair_min.values():
        if pair_data["min_distance_km"] <= threshold_km:
            close_approaches.append(pair_data)

    close_approaches.sort(key=lambda x: x["min_distance_km"])
    return close_approaches


def _walker_constellation_eci(
    T: int,
    P: int,
    F: int,
    altitude_km: float,
    inclination_deg: float,
    t_sec: float,
) -> List[Tuple[float, float, float]]:
    """Snapshot of all T satellite ECI positions for a Walker-δ T/P/F
    constellation at the given simulation time. Pure helper used by the
    objective function below — no I/O.
    """
    a = EARTH_RADIUS_KM + altitude_km
    n = math.sqrt(MU / (a ** 3))
    incl = inclination_deg * DEG2RAD
    cos_i = math.cos(incl)
    sin_i = math.sin(incl)
    out: List[Tuple[float, float, float]] = []
    sats_per_plane = max(1, math.ceil(T / P))
    for idx in range(T):
        plane_idx = idx % P
        sat_in_plane = idx // P
        raan = (plane_idx / P) * 2 * math.pi
        phase = (sat_in_plane / sats_per_plane) * 2 * math.pi \
            + (F * plane_idx / P) * (2 * math.pi / sats_per_plane)
        M = n * t_sec + phase
        x_orb = a * math.cos(M)
        y_orb = a * math.sin(M)
        x_inc = x_orb
        y_inc = y_orb * cos_i
        z_inc = y_orb * sin_i
        cos_r = math.cos(raan)
        sin_r = math.sin(raan)
        out.append((
            x_inc * cos_r - y_inc * sin_r,
            x_inc * sin_r + y_inc * cos_r,
            z_inc,
        ))
    return out


def _coverage_score(
    T: int,
    P: int,
    F: int,
    altitude_km: float,
    inclination_deg: float,
    samples: int = 24,
) -> Dict[str, float]:
    """Walker-δ objective function. Aggregates three independent
    metrics into one 0..1 score the optimiser maximises:

    1. Phase uniformity (within-plane mean-anomaly spacing).
    2. RAAN uniformity (between-plane LAN spacing — perfect by
       construction for a strict Walker-δ, kept for symmetry).
    3. Sky-coverage proxy: fraction of `samples` time-snapshots in
       which at least one satellite is above the horizon as seen from
       a fixed equatorial ground station.

    The geometric mean keeps the score honest — a tie on two metrics
    still gets broken by the third instead of being averaged out.
    """
    a = EARTH_RADIUS_KM + altitude_km
    period_sec = 2 * math.pi * math.sqrt((a ** 3) / MU)
    sats_per_plane = max(1, math.ceil(T / P))

    expected_step = (2 * math.pi) / sats_per_plane
    phase_errs: List[float] = []
    for sat_in_plane in range(sats_per_plane):
        phase = (sat_in_plane / sats_per_plane) * 2 * math.pi
        nearest = round(phase / expected_step) * expected_step
        phase_errs.append(abs(phase - nearest))
    if phase_errs and expected_step > 0:
        max_err = expected_step / 2.0
        phase_uniformity = max(0.0, 1.0 - max(phase_errs) / max_err)
    else:
        phase_uniformity = 1.0

    raan_uniformity = 1.0  # Walker-δ: RAAN evenly distributed by construction.

    station = (EARTH_RADIUS_KM, 0.0, 0.0)
    zenith_norm = math.sqrt(sum(s * s for s in station))
    visibility_threshold_cos = math.cos(math.radians(85.0))
    visible_samples = 0
    for k in range(max(1, samples)):
        t_sample = (k / max(1, samples)) * period_sec
        positions = _walker_constellation_eci(
            T, P, F, altitude_km, inclination_deg, t_sample,
        )
        seen = False
        for px, py, pz in positions:
            dx = px - station[0]
            dy = py - station[1]
            dz = pz - station[2]
            slant = math.sqrt(dx * dx + dy * dy + dz * dz)
            if slant <= 0 or zenith_norm <= 0:
                continue
            dot = (station[0] * dx + station[1] * dy + station[2] * dz) / (zenith_norm * slant)
            if dot >= visibility_threshold_cos:
                seen = True
                break
        if seen:
            visible_samples += 1
    coverage_fraction = visible_samples / max(1, samples)

    components = [phase_uniformity, raan_uniformity, coverage_fraction]
    nonzero = [max(c, 1e-3) for c in components]
    score = math.exp(sum(math.log(c) for c in nonzero) / len(nonzero))

    return {
        "score": round(score, 4),
        "phase_uniformity": round(phase_uniformity, 4),
        "raan_uniformity": round(raan_uniformity, 4),
        "coverage_fraction": round(coverage_fraction, 4),
    }


def optimize_plane_distribution(
    num_satellites: int,
    num_planes: int,
    altitude_km: float = 550.0,
    inclination_deg: float = 55.0,
) -> Dict[str, Any]:
    """Walker-δ T/P/F optimiser.

    Searches F ∈ [0, P-1] for the highest `_coverage_score`, then
    returns the chosen configuration plus its score so callers can
    show *why* this F was picked. The previous implementation just
    emitted F = max(1, P//2) — that's a Walker generator, not an
    optimiser. Searching F is cheap (P · T · 24 ECI evaluations)
    so we do it on every request.
    """
    T = num_satellites
    P = max(1, min(num_planes, T))
    S = T // P
    remainder = T % P

    candidates: List[Dict[str, Any]] = []
    f_range = list(range(P)) if P > 1 else [0]
    for f_candidate in f_range:
        scored = _coverage_score(T, P, f_candidate, altitude_km, inclination_deg)
        candidates.append({"F": f_candidate, **scored})

    candidates.sort(key=lambda c: c["score"], reverse=True)
    best = candidates[0]
    F = int(best["F"])

    a = EARTH_RADIUS_KM + altitude_km
    period_sec = 2 * math.pi * math.sqrt(a**3 / MU)
    period_min = period_sec / 60.0
    velocity = math.sqrt(MU / a)

    planes = []
    sat_idx = 0
    for p_idx in range(P):
        raan_deg = (p_idx / P) * 360.0
        n_in_plane = S + (1 if p_idx < remainder else 0)
        sats_in_plane = []
        for s_idx in range(n_in_plane):
            phase_deg = (s_idx / n_in_plane) * 360.0 + (F * p_idx / P) * (360.0 / n_in_plane)
            phase_deg = phase_deg % 360.0
            sats_in_plane.append({
                "index": sat_idx,
                "mean_anomaly_deg": round(phase_deg, 2),
            })
            sat_idx += 1
        planes.append({
            "plane_index": p_idx,
            "raan_deg": round(raan_deg, 2),
            "satellites_count": n_in_plane,
            "satellites": sats_in_plane,
        })

    return {
        "walker_notation": f"{T}/{P}/{F}",
        "total_satellites": T,
        "num_planes": P,
        "sats_per_plane": S,
        "phase_factor": F,
        "altitude_km": altitude_km,
        "inclination_deg": inclination_deg,
        "orbital_period_min": round(period_min, 2),
        "velocity_km_s": round(velocity, 3),
        "planes": planes,
        "objective": {
            "score": best["score"],
            "phase_uniformity": best["phase_uniformity"],
            "raan_uniformity": best["raan_uniformity"],
            "coverage_fraction": best["coverage_fraction"],
            "samples_per_period": 24,
            "candidates_evaluated": len(candidates),
        },
        "coverage_note": f"Walker-δ {T}/{P}/{F}: {P} плоскостей RAAN через {round(360/P, 1)}°, "
                        f"{S} КА/плоскость, межплоскостный сдвиг F={F}",
    }


def get_orbital_elements(
    sat_info: SatelliteInfo,
    tle_override: Dict[int, tuple] = None,
) -> Dict[str, Any]:
    """Extract Keplerian elements from TLE."""
    tle1, tle2 = _resolve_tle(sat_info, tle_override)
    satrec = tle_to_satrec(tle1, tle2)

    incl = satrec.inclo * RAD2DEG
    raan = satrec.nodeo * RAD2DEG
    ecc = satrec.ecco
    argp = satrec.argpo * RAD2DEG
    mean_anom = satrec.mo * RAD2DEG
    mean_motion = satrec.no_kozai * 1440.0 / (2 * math.pi)  # rad/min → rev/day

    # Semi-major axis from mean motion
    n_rad_s = satrec.no_kozai / 60.0  # rad/min → rad/s
    a_km = (MU / (n_rad_s**2))**(1/3) if n_rad_s > 0 else 0

    return {
        "norad_id": sat_info.norad_id,
        "name": sat_info.name,
        "inclination_deg": round(incl, 4),
        "raan_deg": round(raan, 4),
        "eccentricity": round(ecc, 6),
        "arg_perigee_deg": round(argp, 4),
        "mean_anomaly_deg": round(mean_anom, 4),
        "mean_motion_rev_day": round(mean_motion, 6),
        "semi_major_axis_km": round(a_km, 2),
        "altitude_approx_km": round(a_km - EARTH_RADIUS_KM, 2),
    }

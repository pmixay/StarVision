/**
 * clamps.ts — Parameter bounds shared by UI, store, and StarAI sanitize.
 * Match backend validation in main.py endpoints.
 */

export const SAT_COUNT_MIN = 3;
export const SAT_COUNT_MAX = 15;

export const TIME_SPEED_MIN = 1;
export const TIME_SPEED_MAX = 200;

export const COMM_RANGE_MIN_KM = 50;
export const COMM_RANGE_MAX_KM = 2000;

export const ORBIT_ALT_MIN_KM = 400;
export const ORBIT_ALT_MAX_KM = 2000;

export const ORBITAL_PLANES_MIN = 1;
export const ORBITAL_PLANES_MAX = 7;

// Inclination range for the virtual Walker constellation. The backend
// `/api/optimize-planes` accepts 0..180°, so the same bounds apply
// here. Keep min slightly above 0 to dodge a degenerate equatorial
// case where the F = 0 phase offset collapses onto the RAAN ring.
export const ORBIT_INCLINATION_MIN_DEG = 0;
export const ORBIT_INCLINATION_MAX_DEG = 180;
export const ORBIT_INCLINATION_DEFAULT_DEG = 55;

export function clamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  return Math.max(lo, Math.min(hi, value));
}

export function clampSatelliteCount(n: number): number {
  return Math.round(clamp(n, SAT_COUNT_MIN, SAT_COUNT_MAX));
}

export function clampTimeSpeed(n: number): number {
  return clamp(n, TIME_SPEED_MIN, TIME_SPEED_MAX);
}

export function clampCommRangeKm(n: number): number {
  return clamp(n, COMM_RANGE_MIN_KM, COMM_RANGE_MAX_KM);
}

/** 0 means "real TLE mode"; any positive value is clamped into [ORBIT_ALT_MIN_KM, ORBIT_ALT_MAX_KM]. */
export function clampOrbitAltitudeKm(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return clamp(n, ORBIT_ALT_MIN_KM, ORBIT_ALT_MAX_KM);
}

export function clampOrbitalPlanes(n: number): number {
  return Math.round(clamp(n, ORBITAL_PLANES_MIN, ORBITAL_PLANES_MAX));
}

export function clampOrbitInclinationDeg(n: number): number {
  return clamp(n, ORBIT_INCLINATION_MIN_DEG, ORBIT_INCLINATION_MAX_DEG);
}

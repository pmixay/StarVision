/**
 * orbital.ts — shared orbital constants and the single source of truth
 * for the virtual Walker-δ ECI generator.
 *
 * Three components (Scene3D, Satellites, InterSatelliteLinks,
 * CoverageZones) used to keep their own near-identical copies of this
 * formula. Drift between copies caused subtle visual desyncs (a
 * satellite pinned by the camera follow could lag its own coverage
 * cone). Keep all virtual-orbit math here.
 */

export const EARTH_RADIUS_KM = 6371.0;
export const EARTH_MU_KM3_S2 = 398600.4418;
export const SCENE_SCALE = 1 / EARTH_RADIUS_KM;

const DEFAULT_INCLINATION_RAD = (55 * Math.PI) / 180;

export interface ECI {
  x: number;
  y: number;
  z: number;
}

/**
 * Walker-δ circular orbit position for a virtual constellation.
 *
 * @param index        zero-based satellite index in the constellation
 * @param total        total number of satellites
 * @param altitudeKm   orbit altitude above Earth, in kilometres
 * @param simTimeSec   simulation time in seconds
 * @param planes       number of equally-spaced orbital planes (>=1)
 * @param inclinationRad  optional inclination override (default 55°)
 */
export function computeVirtualECI(
  index: number,
  total: number,
  altitudeKm: number,
  simTimeSec: number,
  planes: number = 1,
  inclinationRad: number = DEFAULT_INCLINATION_RAD,
): ECI {
  const a = EARTH_RADIUS_KM + altitudeKm;
  const n = Math.sqrt(EARTH_MU_KM3_S2 / (a * a * a));
  const P = Math.max(1, Math.min(planes, total));
  const satsPerPlane = Math.max(1, Math.ceil(total / P));
  const planeIdx = index % P;
  const satInPlane = Math.floor(index / P);
  const raan = (planeIdx / P) * 2 * Math.PI;
  // Walker-δ T/P/F: inter-plane phase offset for uniform coverage.
  const F = P > 1 ? Math.max(1, Math.floor(P / 2)) : 0;
  const phase =
    (satInPlane / satsPerPlane) * 2 * Math.PI +
    ((F * planeIdx) / P) * ((2 * Math.PI) / satsPerPlane);
  const M = n * simTimeSec + phase;

  const xOrb = a * Math.cos(M);
  const yOrb = a * Math.sin(M);

  const xInc = xOrb;
  const yInc = yOrb * Math.cos(inclinationRad);
  const zInc = yOrb * Math.sin(inclinationRad);

  const cosR = Math.cos(raan);
  const sinR = Math.sin(raan);

  return {
    x: xInc * cosR - yInc * sinR,
    y: xInc * sinR + yInc * cosR,
    z: zInc,
  };
}

/** Period of a circular orbit at the given altitude, in seconds. */
export function circularOrbitPeriodSec(altitudeKm: number): number {
  const a = EARTH_RADIUS_KM + altitudeKm;
  return 2 * Math.PI * Math.sqrt((a * a * a) / EARTH_MU_KM3_S2);
}

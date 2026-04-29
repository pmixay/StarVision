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
export const DEFAULT_INCLINATION_DEG = 55;

const DEFAULT_INCLINATION_RAD = (DEFAULT_INCLINATION_DEG * Math.PI) / 180;

export interface ECI {
  x: number;
  y: number;
  z: number;
}

export interface WalkerLayout {
  totalSatellites: number;
  effectivePlanes: number;
  baseSatellitesPerPlane: number;
  remainderSatellites: number;
  phaseFactor: number;
}

function julianDateFromUnixMs(unixMs: number): number {
  return unixMs / 86400000 + 2440587.5;
}

function normalizeLongitudeDeg(lonDeg: number): number {
  return ((lonDeg + 180) % 360 + 360) % 360 - 180;
}

export function getWalkerLayout(total: number, planes: number): WalkerLayout {
  const totalSatellites = Math.max(1, Math.floor(total) || 1);
  const effectivePlanes = Math.max(1, Math.min(Math.floor(planes) || 1, totalSatellites));
  const baseSatellitesPerPlane = Math.floor(totalSatellites / effectivePlanes);
  const remainderSatellites = totalSatellites % effectivePlanes;
  const phaseFactor = effectivePlanes > 1 ? Math.max(1, Math.floor(effectivePlanes / 2)) : 0;
  return {
    totalSatellites,
    effectivePlanes,
    baseSatellitesPerPlane,
    remainderSatellites,
    phaseFactor,
  };
}

function getWalkerSlot(index: number, total: number, planes: number) {
  const layout = getWalkerLayout(total, planes);
  const safeIndex = Math.max(0, Math.min(Math.floor(index) || 0, layout.totalSatellites - 1));
  const largerPlaneSize = layout.baseSatellitesPerPlane + 1;
  const largerBlockSize = layout.remainderSatellites * largerPlaneSize;

  if (safeIndex < largerBlockSize) {
    return {
      ...layout,
      planeIdx: Math.floor(safeIndex / largerPlaneSize),
      satInPlane: safeIndex % largerPlaneSize,
      satsInPlane: largerPlaneSize,
    };
  }

  const smallerIndex = safeIndex - largerBlockSize;
  return {
    ...layout,
    planeIdx: layout.remainderSatellites + Math.floor(smallerIndex / layout.baseSatellitesPerPlane),
    satInPlane: smallerIndex % layout.baseSatellitesPerPlane,
    satsInPlane: layout.baseSatellitesPerPlane,
  };
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
  const { effectivePlanes, phaseFactor, planeIdx, satInPlane, satsInPlane } = getWalkerSlot(index, total, planes);
  const raan = (planeIdx / effectivePlanes) * 2 * Math.PI;
  const phase =
    (satInPlane / satsInPlane) * 2 * Math.PI +
    ((phaseFactor * planeIdx) / effectivePlanes) * ((2 * Math.PI) / satsInPlane);
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

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function eciLongitudeDegAtTime(x: number, y: number, unixMs: number): number {
  const jd = julianDateFromUnixMs(unixMs);
  const t = (jd - 2451545.0) / 36525.0;
  const gmst =
    280.46061837 +
    360.98564736629 * (jd - 2451545.0) +
    0.000387933 * t * t -
    (t * t * t) / 38710000.0;
  const lonEciDeg = Math.atan2(y, x) * (180 / Math.PI);
  return normalizeLongitudeDeg(lonEciDeg - gmst);
}

/** Period of a circular orbit at the given altitude, in seconds. */
export function circularOrbitPeriodSec(altitudeKm: number): number {
  const a = EARTH_RADIUS_KM + altitudeKm;
  return 2 * Math.PI * Math.sqrt((a * a * a) / EARTH_MU_KM3_S2);
}

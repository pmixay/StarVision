/**
 * Tests for the deduplicated virtual-orbit math in src/lib/orbital.ts.
 * The four call-sites that used to keep their own copies must agree
 * with this single implementation, so we lock in the contract here.
 */

import { describe, it, expect } from 'vitest';
import {
  EARTH_RADIUS_KM,
  EARTH_MU_KM3_S2,
  circularOrbitPeriodSec,
  computeVirtualECI,
} from '../lib/orbital';

describe('computeVirtualECI', () => {
  it('places a satellite on a sphere of radius R+altitude at t=0', () => {
    const altKm = 600;
    const r0 = computeVirtualECI(0, 1, altKm, 0, 1);
    const radius = Math.sqrt(r0.x * r0.x + r0.y * r0.y + r0.z * r0.z);
    expect(radius).toBeCloseTo(EARTH_RADIUS_KM + altKm, 6);
  });

  it('returns to its starting position after one period', () => {
    const altKm = 550;
    const period = circularOrbitPeriodSec(altKm);
    const start = computeVirtualECI(0, 1, altKm, 0, 1);
    const end = computeVirtualECI(0, 1, altKm, period, 1);
    expect(end.x).toBeCloseTo(start.x, 4);
    expect(end.y).toBeCloseTo(start.y, 4);
    expect(end.z).toBeCloseTo(start.z, 4);
  });

  it('spreads satellites in a single plane uniformly in mean anomaly', () => {
    // Four sats, one plane → quarter-period apart.
    const total = 4;
    const altKm = 500;
    const period = circularOrbitPeriodSec(altKm);
    const a = EARTH_RADIUS_KM + altKm;

    const positions = Array.from({ length: total }, (_, i) =>
      computeVirtualECI(i, total, altKm, 0, 1),
    );
    // Each is at distance a from origin.
    for (const p of positions) {
      const r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
      expect(r).toBeCloseTo(a, 6);
    }
    // Sat 0 advanced by period/4 should equal sat 1 at t=0.
    const sat0Quarter = computeVirtualECI(0, total, altKm, period / 4, 1);
    expect(sat0Quarter.x).toBeCloseTo(positions[1].x, 4);
    expect(sat0Quarter.y).toBeCloseTo(positions[1].y, 4);
    expect(sat0Quarter.z).toBeCloseTo(positions[1].z, 4);
  });

  it('clamps planes to [1, total]', () => {
    const altKm = 400;
    // planes=99 with total=4 must behave the same as planes=4.
    const a = computeVirtualECI(0, 4, altKm, 0, 99);
    const b = computeVirtualECI(0, 4, altKm, 0, 4);
    expect(a.x).toBeCloseTo(b.x, 9);
    expect(a.y).toBeCloseTo(b.y, 9);
    expect(a.z).toBeCloseTo(b.z, 9);
  });
});

describe('circularOrbitPeriodSec', () => {
  it('matches Kepler\'s third law', () => {
    const altKm = 400;
    const a = EARTH_RADIUS_KM + altKm;
    const expected = 2 * Math.PI * Math.sqrt((a * a * a) / EARTH_MU_KM3_S2);
    expect(circularOrbitPeriodSec(altKm)).toBeCloseTo(expected, 6);
  });

  it('LEO period is roughly 90 minutes', () => {
    const periodMin = circularOrbitPeriodSec(550) / 60;
    expect(periodMin).toBeGreaterThan(85);
    expect(periodMin).toBeLessThan(100);
  });
});

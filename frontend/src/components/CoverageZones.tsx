/**
 * CoverageZones.tsx
 * Physically-sized ground coverage footprints on a near-surface globe shell.
 *
 * Rendering uses a shader over a transparent sphere shell. The shader colors
 * only fragments inside the satellite horizon angle, so the footprint follows
 * the Earth's curvature without relying on fragile near-surface cap geometry.
 */

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, FrontSide, Mesh, ShaderMaterial, Vector3 } from 'three';
import { twoline2satrec, propagate } from 'satellite.js';
import { getSimTime } from '../simClock';
import { useStore } from '../hooks/useStore';
import { CONSTELLATION_COLORS, CONSTELLATION_NAMES } from '../constants';
import { computeVirtualECI, EARTH_RADIUS_KM, SCENE_SCALE } from '../lib/orbital';
import type { SatellitePosition, TLEData } from '../types';

const R_E = EARTH_RADIUS_KM;
const SCALE = SCENE_SCALE;
const SHELL_RADIUS = 1.008;
const MAX_SATS = 15;
const MIN_ELEVATION_RAD = 10 * Math.PI / 180;

const VERTEX_SHADER = `
  varying vec3 vDir;

  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  uniform vec3 uCenterDir;
  uniform vec3 uCameraDir;
  uniform vec3 uColor;
  uniform float uCosTheta;
  uniform float uOpacity;

  varying vec3 vDir;

  void main() {
    vec3 dir = normalize(vDir);

    // Do not draw far-side shell fragments through/around the Earth limb.
    if (dot(dir, normalize(uCameraDir)) <= 0.0) discard;

    float d = dot(dir, normalize(uCenterDir));

    // Inside footprint when angular distance <= theta, i.e. d >= cos(theta).
    float edgeSoftness = 0.006;
    float fill = smoothstep(uCosTheta - edgeSoftness, uCosTheta + edgeSoftness, d);

    // Crisp boundary at the physical coverage angle.
    float ringDistance = abs(d - uCosTheta);
    float ring = 1.0 - smoothstep(0.0009, 0.0018, ringDistance);

    float alpha = fill * 0.16 + ring * 0.34;
    if (alpha < 0.01) discard;

    vec3 color = mix(uColor, vec3(1.0), ring * 0.28);
    gl_FragColor = vec4(color, alpha * uOpacity);
  }
`;

function getColor(constellation: string): string {
  return CONSTELLATION_COLORS[constellation] ?? '#35f5ff';
}

function selectUniformly<T>(arr: T[], count: number): T[] {
  if (count >= arr.length) return arr;
  const step = arr.length / count;
  return Array.from({ length: count }, (_, i) => arr[Math.floor(i * step)]);
}

const virtualECI = computeVirtualECI;

function usefulCoverageCosTheta(rKm: number, commRangeKm: number): number | null {
  const altitudeKm = rKm - R_E;
  if (altitudeKm <= 0 || commRangeKm <= altitudeKm) return null;

  const sinElev = Math.sin(MIN_ELEVATION_RAD);
  const cosElev = Math.cos(MIN_ELEVATION_RAD);
  const rangeAtMinElevation = Math.sqrt(Math.max(0, rKm * rKm - R_E * R_E * cosElev * cosElev))
    - R_E * sinElev;

  const slantKm = Math.min(commRangeKm, rangeAtMinElevation);
  if (!Number.isFinite(slantKm) || slantKm <= altitudeKm) return null;

  const cosTheta = (rKm * rKm + R_E * R_E - slantKm * slantKm) / (2 * rKm * R_E);
  return Math.max(-1, Math.min(1, cosTheta));
}

type CoverageItem = {
  id: number;
  color: string;
  tle?: TLEData;
  position?: SatellitePosition;
  virtualIndex?: number;
  virtualTotal?: number;
  virtualAltKm?: number;
  virtualPlanes?: number;
};

function CoverageFootprint({ item, commRangeKm }: { item: CoverageItem; commRangeKm: number }) {
  const meshRef = useRef<Mesh>(null);
  const centerDirRef = useRef(new Vector3());
  const cameraDirRef = useRef(new Vector3());

  const satrec = useMemo(() => {
    if (!item.tle) return null;
    return twoline2satrec(item.tle.tle_line1, item.tle.tle_line2);
  }, [item.tle]);

  const material = useMemo(() => {
    return new ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: FrontSide,
      uniforms: {
        uCenterDir: { value: new Vector3(1, 0, 0) },
        uCameraDir: { value: new Vector3(0, 0, 1) },
        uColor: { value: new Color(item.color) },
        uCosTheta: { value: 1 },
        uOpacity: { value: 0.9 },
      },
    });
  }, [item.color]);

  useFrame(({ camera }) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    let eci: { x: number; y: number; z: number } | null = null;

    if (item.virtualIndex !== undefined && item.virtualTotal !== undefined && item.virtualAltKm !== undefined) {
      eci = virtualECI(
        item.virtualIndex,
        item.virtualTotal,
        item.virtualAltKm,
        getSimTime() / 1000,
        item.virtualPlanes ?? 1,
      );
    } else if (satrec) {
      const pv = propagate(satrec, new Date(getSimTime()));
      if (pv.position && typeof pv.position !== 'boolean') {
        eci = pv.position as { x: number; y: number; z: number };
      }
    } else if (item.position) {
      eci = item.position.eci;
    }

    if (!eci) {
      mesh.visible = false;
      return;
    }

    const rKm = Math.sqrt(eci.x * eci.x + eci.y * eci.y + eci.z * eci.z);
    if (!Number.isFinite(rKm) || rKm < R_E + 50) {
      mesh.visible = false;
      return;
    }

    centerDirRef.current.set(eci.x * SCALE, eci.z * SCALE, -eci.y * SCALE).normalize();
    cameraDirRef.current.copy(camera.position).normalize();

    material.uniforms.uCenterDir.value.copy(centerDirRef.current);
    material.uniforms.uCameraDir.value.copy(cameraDirRef.current);
    const cosTheta = usefulCoverageCosTheta(rKm, commRangeKm);
    if (cosTheta == null) {
      mesh.visible = false;
      return;
    }
    material.uniforms.uCosTheta.value = cosTheta;
    mesh.visible = true;
  });

  return (
    <mesh ref={meshRef} renderOrder={220} frustumCulled={false} visible={false}>
      <sphereGeometry args={[SHELL_RADIUS, 96, 48]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

export interface CoverageZonesProps {
  positions: SatellitePosition[];
  tleData: TLEData[];
  satelliteConstellations: Record<number, string>;
}

export function CoverageZones({ positions, tleData, satelliteConstellations }: CoverageZonesProps) {
  const showCoverage = useStore((s) => s.showCoverage);
  const satelliteCount = useStore((s) => s.satelliteCount);
  const orbitAltitudeKm = useStore((s) => s.orbitAltitudeKm);
  const orbitalPlanes = useStore((s) => s.orbitalPlanes);
  const activeConstellations = useStore((s) => s.activeConstellations);
  const commRangeKm = useStore((s) => s.commRangeKm);

  const items = useMemo<CoverageItem[]>(() => {
    if (orbitAltitudeKm > 0) {
      const virtualItems: CoverageItem[] = [];
      for (let i = 0; i < satelliteCount; i++) {
        const constellation = CONSTELLATION_NAMES[i % CONSTELLATION_NAMES.length];
        if (!activeConstellations.includes(constellation)) continue;
        virtualItems.push({
          id: 90000 + i,
          color: getColor(constellation),
          virtualIndex: i,
          virtualTotal: satelliteCount,
          virtualAltKm: orbitAltitudeKm,
          virtualPlanes: orbitalPlanes,
        });
      }
      return virtualItems.slice(0, MAX_SATS);
    }

    const positionById = new Map(positions.map((pos) => [pos.norad_id, pos]));

    if (tleData.length > 0) {
      const filtered = tleData.filter((tle) => {
        const constellation = satelliteConstellations[tle.norad_id] ?? tle.constellation;
        return !constellation || activeConstellations.includes(constellation);
      });
      return selectUniformly(filtered, satelliteCount).slice(0, MAX_SATS).map((tle) => {
        const constellation = satelliteConstellations[tle.norad_id] ?? tle.constellation;
        return {
          id: tle.norad_id,
          color: getColor(constellation),
          tle,
          position: positionById.get(tle.norad_id),
        };
      });
    }

    const filtered = positions.filter((pos) => {
      const constellation = satelliteConstellations[pos.norad_id];
      return !constellation || activeConstellations.includes(constellation);
    });
    return selectUniformly(filtered, satelliteCount).slice(0, MAX_SATS).map((position) => ({
      id: position.norad_id,
      color: getColor(satelliteConstellations[position.norad_id] ?? ''),
      position,
    }));
  }, [activeConstellations, orbitAltitudeKm, orbitalPlanes, positions, satelliteConstellations, satelliteCount, tleData]);

  if (!showCoverage || items.length === 0) return null;

  return (
    <group>
      {items.map((item) => (
        <CoverageFootprint key={item.id} item={item} commRangeKm={commRangeKm} />
      ))}
    </group>
  );
}

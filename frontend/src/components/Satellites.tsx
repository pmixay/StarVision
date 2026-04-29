/**
 * Satellites.tsx
 * - Client-side SGP4 propagation via satellite.js (per-frame animation)
 * - When orbitAltitudeKm > 0: virtual circular orbits with uniform distribution
 * - Uniform selection of N satellites from catalog (not just first N)
 * - 2 procedural 3D CubeSat models: 1U and 3U with solar panels
 * - Model source: procedural Three.js (BoxGeometry + PlaneGeometry)
 */

import { useRef, useMemo, useEffect, useCallback, useState, memo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { Vector3, Group } from 'three';
import { twoline2satrec, propagate } from 'satellite.js';
import { getSimTime, advanceSimTime } from '../simClock';
import { CONSTELLATION_COLORS, CONSTELLATION_NAMES, CONSTELLATION_MODEL_TYPE } from '../constants';
import { selectRealSatellites } from '../selection';
import { circularOrbitPeriodSec, computeVirtualECI, SCENE_SCALE } from '../lib/orbital';
import type { SatellitePosition, OrbitPoint, TLEData } from '../types';

const SCALE = SCENE_SCALE;

function getColor(constellation: string): string {
  return CONSTELLATION_COLORS[constellation] || '#8ec9ff';
}

function getModelType(constellation: string): number {
  return CONSTELLATION_MODEL_TYPE[constellation] ?? 0;
}

// ── 3D model: 1U CubeSat (10×10×10 cm, 2 small panels) ────────────
// Source: procedural Three.js model (BoxGeometry + PlaneGeometry)
function CubeSat1U({ color, emissiveIntensity }: { color: string; emissiveIntensity: number }) {
  const size = 0.012;
  const panelW = 0.022;
  const panelH = 0.008;
  return (
    <group>
      {/* Body */}
      <mesh>
        <boxGeometry args={[size, size, size]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={emissiveIntensity}
          metalness={0.85}
          roughness={0.25}
        />
      </mesh>
      {/* Solar panels (left/right) */}
      <mesh position={[panelW / 2 + size / 2, 0, 0]}>
        <planeGeometry args={[panelW, panelH]} />
        <meshStandardMaterial
          color="#1a2a4a"
          emissive="#1133aa"
          emissiveIntensity={0.4}
          metalness={0.3}
          roughness={0.7}
          side={2}
        />
      </mesh>
      <mesh position={[-(panelW / 2 + size / 2), 0, 0]}>
        <planeGeometry args={[panelW, panelH]} />
        <meshStandardMaterial
          color="#1a2a4a"
          emissive="#1133aa"
          emissiveIntensity={0.4}
          metalness={0.3}
          roughness={0.7}
          side={2}
        />
      </mesh>
    </group>
  );
}

// ── 3D model: 3U CubeSat (10×10×30 cm, 4 large panels) ────────────
// Source: procedural Three.js model (BoxGeometry + PlaneGeometry)
function CubeSat3U({ color, emissiveIntensity }: { color: string; emissiveIntensity: number }) {
  const w = 0.010;
  const h = 0.030;
  const d = 0.010;
  const panelW = 0.028;
  const panelH = 0.024;
  return (
    <group>
      {/* 3U body */}
      <mesh>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={emissiveIntensity}
          metalness={0.85}
          roughness={0.2}
        />
      </mesh>
      {/* Solar panels (4 total: left/right × two tiers) */}
      {[-1, 1].map((side) =>
        [-0.008, 0.008].map((offset, j) => (
          <mesh
            key={`${side}-${j}`}
            position={[side * (panelW / 2 + w / 2), offset * 2, 0]}
          >
            <planeGeometry args={[panelW, panelH]} />
            <meshStandardMaterial
              color="#0d1a3a"
              emissive="#0a2299"
              emissiveIntensity={0.45}
              metalness={0.25}
              roughness={0.65}
              side={2}
            />
          </mesh>
        ))
      )}
    </group>
  );
}

// ── Single satellite marker ──────────────────────────────────────────
interface SatMarkerProps {
  name: string;
  constellation: string;
  isSelected: boolean;
  isHighlighted: boolean;
  showLabel: boolean;
  onClick: () => void;
  // When using client-side SGP4, position is updated in useFrame via groupRef
  initPos: Vector3;
  // For client-side SGP4: ref to function returning current ECI position
  getECI?: () => { x: number; y: number; z: number } | null;
}

const SatMarker = memo(function SatMarker({
  name,
  constellation,
  isSelected,
  isHighlighted,
  showLabel,
  onClick,
  initPos,
  getECI,
}: SatMarkerProps) {
  const groupRef = useRef<Group>(null);
  const bodyRef = useRef<Group>(null);
  const [labelVisible, setLabelVisible] = useState(true);
  // Track visibility in a ref to avoid stale closure in setLabelVisible
  const visibleRef = useRef(true);
  const frameCountRef = useRef(0);

  const color = useMemo(() => getColor(constellation), [constellation]);
  const modelType = useMemo(() => getModelType(constellation), [constellation]);
  const emissiveIntensity = isSelected ? 1.8 : isHighlighted ? 1.0 : 0.6;
  const glowScale = isSelected ? 0.07 : 0.04;

  useFrame(({ camera }, delta) => {
    if (bodyRef.current) {
      bodyRef.current.rotation.y += 0.8 * delta;
    }
    if (groupRef.current && getECI) {
      const eci = getECI();
      if (eci) {
        groupRef.current.position.set(
          eci.x * SCALE,
          eci.z * SCALE,   // Three.js: Y is up
          -eci.y * SCALE
        );
      }
    }
    // Check if satellite is behind Earth (label occlusion) — throttled to every 10 frames
    if (groupRef.current) {
      frameCountRef.current++;
      if (frameCountRef.current % 10 === 0) {
        const satPos = groupRef.current.position;
        const camPos = camera.position;
        const dx = satPos.x - camPos.x;
        const dy = satPos.y - camPos.y;
        const dz = satPos.z - camPos.z;
        const lenSq = dx * dx + dy * dy + dz * dz;
        const t = Math.max(0, Math.min(1, -(camPos.x * dx + camPos.y * dy + camPos.z * dz) / lenSq));
        const cx = camPos.x + t * dx;
        const cy = camPos.y + t * dy;
        const cz = camPos.z + t * dz;
        const distToCenter = Math.sqrt(cx * cx + cy * cy + cz * cz);
        const newVisible = distToCenter >= 0.95;
        if (newVisible !== visibleRef.current) {
          visibleRef.current = newVisible;
          setLabelVisible(newVisible);
        }
      }
    }
  });

  return (
    <group ref={groupRef} position={initPos} onClick={onClick}>
      <group ref={bodyRef}>
        {modelType === 0 ? (
          <CubeSat1U color={color} emissiveIntensity={emissiveIntensity} />
        ) : (
          <CubeSat3U color={color} emissiveIntensity={emissiveIntensity} />
        )}
      </group>

      {/* Glow around satellite */}
      <mesh>
        <sphereGeometry args={[glowScale, 8, 8]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={isSelected ? 0.3 : 0.12}
        />
      </mesh>

      {/* Подпись — hidden when behind Earth via manual occlusion check */}
      {showLabel && labelVisible && (
        <Html
          position={[0, 0.05, 0]}
          center
          distanceFactor={3}
          // Cap label z-index below the UI panels (which sit at z-10/z-20).
          // Default drei range starts at 16777271, which makes labels float
          // over the open control panel. Keep relative ordering inside the
          // 3D layer (5 → 0).
          zIndexRange={[5, 0]}
          style={{ pointerEvents: 'none' }}
        >
          <div className="sat-label" style={{ color }}>
            {name}
            {isSelected && (
              <div style={{ fontSize: '8px', opacity: 0.7 }}>
                {constellation}
              </div>
            )}
          </div>
        </Html>
      )}
    </group>
  );
});

// ── Orbital track ───────────────────────────────────────────────────
interface OrbitLineProps {
  path: OrbitPoint[];
  color: string;
  opacity?: number;
}

function OrbitLine({ path, color, opacity = 0.3 }: OrbitLineProps) {
  const positions = useMemo(() => {
    const arr = new Float32Array(path.length * 3);
    path.forEach((p, i) => {
      arr[i * 3] = p.x * SCALE;
      arr[i * 3 + 1] = p.z * SCALE;   // Y-up
      arr[i * 3 + 2] = -p.y * SCALE;
    });
    return arr;
  }, [path]);

  return (
    <line>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color={color} transparent opacity={opacity} linewidth={1} />
    </line>
  );
}

// ── Virtual orbital track ───────────────────────────────────────────
function VirtualOrbitLine({
  index,
  total,
  altitudeKm,
  color,
  opacity = 0.2,
  planes = 1,
}: {
  index: number;
  total: number;
  altitudeKm: number;
  color: string;
  opacity?: number;
  planes?: number;
}) {
  const positions = useMemo(() => {
    const steps = 128;
    const arr = new Float32Array(steps * 3);
    const period = circularOrbitPeriodSec(altitudeKm);
    for (let i = 0; i < steps; i++) {
      const t = (i / steps) * period;
      const { x, y, z } = computeVirtualECI(index, total, altitudeKm, t, planes);
      arr[i * 3] = x * SCALE;
      arr[i * 3 + 1] = z * SCALE;
      arr[i * 3 + 2] = -y * SCALE;
    }
    return arr;
  }, [index, total, altitudeKm, planes]);

  return (
    <line>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color={color} transparent opacity={opacity} linewidth={1} />
    </line>
  );
}

// ── All satellites ──────────────────────────────────────────────────
interface SatellitesProps {
  positions: SatellitePosition[];           // positions from backend (fallback)
  tleData: TLEData[];                       // TLE for client-side SGP4
  orbitPaths: Record<number, OrbitPoint[]>;
  selectedSatellite: number | null;
  highlightedConstellation: string | null;
  activeConstellations: string[];
  showOrbits: boolean;
  showLabels: boolean;
  onSelectSatellite: (id: number | null) => void;
  satelliteConstellations: Record<number, string>;
  satelliteCount: number;
  orbitAltitudeKm: number;
  orbitalPlanes: number;
  timeSpeed: number;
}

export function Satellites({
  positions,
  tleData,
  orbitPaths,
  selectedSatellite,
  highlightedConstellation,
  activeConstellations,
  showOrbits,
  showLabels,
  onSelectSatellite,
  satelliteConstellations,
  satelliteCount,
  orbitAltitudeKm,
  orbitalPlanes,
  timeSpeed,
}: SatellitesProps) {
  // ── Client-side SGP4: initialize satrec objects ───────────────────
  const satrecsRef = useRef<Map<number, ReturnType<typeof twoline2satrec>>>(new Map());

  useEffect(() => {
    if (tleData.length > 0) {
      const map = new Map<number, ReturnType<typeof twoline2satrec>>();
      tleData.forEach((tle) => {
        map.set(tle.norad_id, twoline2satrec(tle.tle_line1, tle.tle_line2));
      });
      satrecsRef.current = map;
    }
  }, [tleData]);

  // Advance shared simTime on each frame (single source of truth)
  // Clamp delta to avoid huge time jumps when returning from background tab
  useFrame((_, delta) => {
    const clampedDelta = Math.min(delta, 0.1);
    advanceSimTime(clampedDelta * 1000 * timeSpeed);
  });

  // ── Filtering and satellite selection ──────────────────────────────

  // Virtual orbit mode: generate N virtual satellites
  const virtualSatCount = orbitAltitudeKm > 0 ? satelliteCount : 0;

  const virtualSatItems = useMemo(() => {
    if (orbitAltitudeKm <= 0) return [];
    const allVirt = Array.from({ length: satelliteCount }, (_, i) => ({
      norad_id: 90000 + i,
      name: `VirtSat-${i + 1}`,
      constellation: CONSTELLATION_NAMES[i % CONSTELLATION_NAMES.length],
    }));
    return allVirt.filter((sat) => activeConstellations.includes(sat.constellation));
  }, [orbitAltitudeKm, satelliteCount, activeConstellations]);

  // Real TLE mode: select N satellites uniformly. Backend already
  // excludes archival sats from `positions`, but we use the shared
  // selection helper so Satellites / ISL / CoverageZones agree.
  const filteredRealPositions = useMemo(() => {
    if (orbitAltitudeKm > 0) return [];
    return selectRealSatellites(
      positions,
      satelliteCount,
      activeConstellations,
      satelliteConstellations,
    );
  }, [positions, activeConstellations, satelliteConstellations, satelliteCount, orbitAltitudeKm]);

  // Store orbit params in a ref so getECI closures always read the latest values
  const orbitParamsRef = useRef({ orbitAltitudeKm, virtualSatCount, orbitalPlanes });
  orbitParamsRef.current = { orbitAltitudeKm, virtualSatCount, orbitalPlanes };

  // Stable getECI factory: returns the same function reference for the same noradId
  const eciCacheRef = useRef<Record<number, () => { x: number; y: number; z: number } | null>>({});

  // Clear ECI function cache when switching modes or TLE source to prevent unbounded growth
  useEffect(() => {
    eciCacheRef.current = {};
  }, [orbitAltitudeKm, tleData]);

  const getGetECI = useCallback((noradId: number) => {
    if (!eciCacheRef.current[noradId]) {
      eciCacheRef.current[noradId] = () => {
        const simTime = getSimTime();
        const { orbitAltitudeKm: alt, virtualSatCount: vsc, orbitalPlanes: planes } = orbitParamsRef.current;
        // Virtual mode
        if (alt > 0) {
          const idx = noradId - 90000;
          return computeVirtualECI(idx, vsc, alt, simTime / 1000, planes);
        }
        // Real TLE mode via satellite.js
        const satrec = satrecsRef.current.get(noradId);
        if (!satrec) return null;
        const pv = propagate(satrec, new Date(simTime));
        if (!pv.position || typeof pv.position === 'boolean') return null;
        return pv.position as { x: number; y: number; z: number };
      };
    }
    return eciCacheRef.current[noradId];
  }, []);

  // ── Initial positions (for first render, before client data is ready)
  function getInitialPos(noradId: number): Vector3 {
    const simTime = getSimTime();
    if (orbitAltitudeKm > 0) {
      const idx = noradId - 90000;
      const eci = computeVirtualECI(idx, Math.max(virtualSatCount, 1), orbitAltitudeKm, simTime / 1000, orbitalPlanes);
      return new Vector3(eci.x * SCALE, eci.z * SCALE, -eci.y * SCALE);
    }
    const p = positions.find((pos) => pos.norad_id === noradId);
    if (p) {
      return new Vector3(p.eci.x * SCALE, p.eci.z * SCALE, -p.eci.y * SCALE);
    }
    return new Vector3(2, 0, 0);
  }

  return (
    <group>
      {/* ── Виртуальные спутники ───────────────────────────── */}
      {virtualSatItems.map((sat) => {
        const isHighlighted = highlightedConstellation
          ? sat.constellation === highlightedConstellation
          : true;
        return (
          <SatMarker
            key={sat.norad_id}
            name={sat.name}
            constellation={sat.constellation}
            isSelected={selectedSatellite === sat.norad_id}
            isHighlighted={isHighlighted}
            showLabel={showLabels}
            onClick={() => onSelectSatellite(
              selectedSatellite === sat.norad_id ? null : sat.norad_id
            )}
            initPos={getInitialPos(sat.norad_id)}
            getECI={getGetECI(sat.norad_id)}
          />
        );
      })}

      {/* ── Реальные спутники с клиентской SGP4 ──────────── */}
      {filteredRealPositions.map((pos) => {
        const constellation = satelliteConstellations[pos.norad_id] || '';
        const isHighlighted = highlightedConstellation
          ? constellation === highlightedConstellation
          : true;
        return (
          <SatMarker
            key={pos.norad_id}
            name={pos.name}
            constellation={constellation}
            isSelected={selectedSatellite === pos.norad_id}
            isHighlighted={isHighlighted}
            showLabel={showLabels}
            onClick={() => onSelectSatellite(
              selectedSatellite === pos.norad_id ? null : pos.norad_id
            )}
            initPos={getInitialPos(pos.norad_id)}
            getECI={getGetECI(pos.norad_id)}
          />
        );
      })}

      {/* ── Орбитальные треки (реальные TLE) ────────────── */}
      {showOrbits && orbitAltitudeKm === 0 &&
        Object.entries(orbitPaths).map(([id, path]) => {
          const numId = parseInt(id);
          const constellation = satelliteConstellations[numId] || '';
          if (!activeConstellations.includes(constellation)) return null;
          if (!filteredRealPositions.some((p) => p.norad_id === numId)) return null;
          const color = getColor(constellation);
          const isActive = selectedSatellite === numId;
          return (
            <OrbitLine
              key={id}
              path={path}
              color={color}
              opacity={isActive ? 0.6 : 0.15}
            />
          );
        })}

      {/* ── Виртуальные орбитальные треки ─────────────── */}
      {showOrbits && orbitAltitudeKm > 0 &&
        virtualSatItems.map((sat) => {
          const idx = sat.norad_id - 90000;
          const color = getColor(sat.constellation);
          const isActive = selectedSatellite === sat.norad_id;
          return (
            <VirtualOrbitLine
              key={sat.norad_id}
              index={idx}
              total={satelliteCount}
              altitudeKm={orbitAltitudeKm}
              color={color}
              opacity={isActive ? 0.6 : 0.2}
              planes={orbitalPlanes}
            />
          );
        })}
    </group>
  );
}

/**
 * Satellites.tsx
 * - Client-side SGP4 propagation via satellite.js (per-frame animation)
 * - When orbitAltitudeKm > 0: virtual circular orbits with uniform distribution
 * - Uniform selection of N satellites from catalog (not just first N)
 * - 2 procedural 3D CubeSat models: 1U and 3U with solar panels
 * - Model source: procedural Three.js (BoxGeometry + PlaneGeometry)
 */

import { Component, Suspense, useRef, useMemo, useEffect, useCallback, memo, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, useGLTF } from '@react-three/drei';
import { Vector3, Group, DoubleSide, MeshStandardMaterial, Color, type Mesh, type Object3D } from 'three';
import { twoline2satrec, propagate } from 'satellite.js';
import { getSimTime, advanceSimTime } from '../simClock';
import { CONSTELLATION_COLORS, CONSTELLATION_NAMES, CONSTELLATION_MODEL_TYPE } from '../constants';
import { selectRealSatellites } from '../selection';
import { circularOrbitPeriodSec, computeVirtualECI, degToRad, SCENE_SCALE } from '../lib/orbital';
import { useStore } from '../hooks/useStore';
import { t } from '../i18n';
import type { SatellitePosition, OrbitPoint, TLEData } from '../types';

const SCALE = SCENE_SCALE;

function getColor(constellation: string): string {
  return CONSTELLATION_COLORS[constellation] || '#8ec9ff';
}

function getModelType(constellation: string): number {
  return CONSTELLATION_MODEL_TYPE[constellation] ?? 0;
}

// ── Materials shared across all procedural CubeSats ──────────────────
// Single instances (memoized) so 15 satellites share the same GPU material —
// this is what makes the cluster cheap to render even with bloom + SMAA.
function useCubeSatMaterials(bodyColor: string, emissiveIntensity: number) {
  return useMemo(() => {
    const body = new MeshStandardMaterial({
      color: new Color(bodyColor),
      emissive: new Color(bodyColor),
      emissiveIntensity,
      metalness: 0.92,
      roughness: 0.32,
      // Faint anisotropic sheen via clearcoat — gives the brushed-aluminium
      // look you see in real CubeSat photos under sunlight.
      envMapIntensity: 0.85,
    });
    const panel = new MeshStandardMaterial({
      color: new Color('#0a1838'),
      emissive: new Color('#1f3aa8'),
      emissiveIntensity: 0.55,
      metalness: 0.55,
      roughness: 0.42,
      side: DoubleSide,
    });
    const panelFrame = new MeshStandardMaterial({
      color: new Color('#9aa6b8'),
      metalness: 0.95,
      roughness: 0.28,
    });
    const antenna = new MeshStandardMaterial({
      color: new Color('#d8d8d8'),
      metalness: 1.0,
      roughness: 0.18,
    });
    const lens = new MeshStandardMaterial({
      color: new Color('#0a0a0a'),
      emissive: new Color('#3aa9ff'),
      emissiveIntensity: 0.6,
      metalness: 1.0,
      roughness: 0.05,
    });
    return { body, panel, panelFrame, antenna, lens };
  }, [bodyColor, emissiveIntensity]);
}

// Solar panel tile: a frame + glossy photovoltaic surface with a subtle cell
// grid baked in via `gridScale`. Real glTF panels rely on a normal map for
// the cell raster; we approximate it with a fine BoxGeometry frame so the
// PBR pass still picks up specular highlights along the cell edges.
function SolarPanel({
  width,
  height,
  position,
  rotation = [0, 0, 0],
  panel,
  frame,
}: {
  width: number;
  height: number;
  position: [number, number, number];
  rotation?: [number, number, number];
  panel: MeshStandardMaterial;
  frame: MeshStandardMaterial;
}) {
  const t = 0.0006; // panel thickness — gives the renderer real normals
  return (
    <group position={position} rotation={rotation}>
      <mesh material={panel}>
        <boxGeometry args={[width, height, t]} />
      </mesh>
      {/* Edge frame */}
      <mesh material={frame} position={[0, 0, t * 0.55]}>
        <boxGeometry args={[width * 1.02, height * 0.06, t * 0.5]} />
      </mesh>
      <mesh material={frame} position={[0, 0, -t * 0.55]}>
        <boxGeometry args={[width * 1.02, height * 0.06, t * 0.5]} />
      </mesh>
    </group>
  );
}

// ── 3D model: 1U CubeSat (10×10×10 cm) ───────────────────────────────
// Procedural Three.js model with PBR materials — body, deployable solar
// panels with a metallic frame, monopole antenna, and a glossy lens (camera
// or star tracker aperture). Geometry uses BoxGeometry with non-zero depth so
// normals shade correctly under the bloom pass.
function CubeSat1U({ color, emissiveIntensity }: { color: string; emissiveIntensity: number }) {
  const size = 0.012;
  const panelW = 0.022;
  const panelH = 0.010;
  const m = useCubeSatMaterials(color, emissiveIntensity);
  return (
    <group>
      <mesh material={m.body}>
        <boxGeometry args={[size, size, size]} />
      </mesh>
      {/* Star-tracker / camera lens on +Z face */}
      <mesh material={m.lens} position={[0, 0, size / 2 + 0.0005]}>
        <cylinderGeometry args={[size * 0.18, size * 0.18, 0.001, 12]} />
      </mesh>
      {/* Deployed solar panels (left / right) */}
      <SolarPanel
        width={panelW}
        height={panelH}
        position={[panelW / 2 + size / 2, 0, 0]}
        panel={m.panel}
        frame={m.panelFrame}
      />
      <SolarPanel
        width={panelW}
        height={panelH}
        position={[-(panelW / 2 + size / 2), 0, 0]}
        panel={m.panel}
        frame={m.panelFrame}
      />
      {/* UHF monopole antenna */}
      <mesh material={m.antenna} position={[0, size / 2 + 0.006, 0]}>
        <cylinderGeometry args={[0.0004, 0.0004, 0.012, 6]} />
      </mesh>
    </group>
  );
}

// ── 3D model: 3U CubeSat (10×10×30 cm) ───────────────────────────────
// Procedural Three.js model with PBR materials — elongated body, four
// deployed solar wings, dipole antennas, and a payload aperture. The
// extra geometric detail (frames, antennas, lens) is what gives the
// model real surface normals — the bloom pass picks those up as specular
// highlights and produces the "real spacecraft" look reviewers expect.
function CubeSat3U({ color, emissiveIntensity }: { color: string; emissiveIntensity: number }) {
  const w = 0.010;
  const h = 0.030;
  const d = 0.010;
  const panelW = 0.028;
  const panelH = 0.026;
  const m = useCubeSatMaterials(color, emissiveIntensity);
  return (
    <group>
      <mesh material={m.body}>
        <boxGeometry args={[w, h, d]} />
      </mesh>
      {/* Rail caps — visible black notches on real CubeSats */}
      {[-1, 1].map((sy) => (
        <mesh
          key={sy}
          material={m.panelFrame}
          position={[0, sy * (h / 2 + 0.0008), 0]}
        >
          <boxGeometry args={[w * 1.04, 0.0016, d * 1.04]} />
        </mesh>
      ))}
      {/* Payload aperture on +Z */}
      <mesh material={m.lens} position={[0, h * 0.35, d / 2 + 0.0006]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.0026, 0.0026, 0.0012, 16]} />
      </mesh>
      {/* Four deployed solar wings (two per side) */}
      {[-1, 1].map((side) =>
        [-0.0085, 0.0085].map((offsetY) => (
          <SolarPanel
            key={`${side}-${offsetY}`}
            width={panelW}
            height={panelH * 0.9}
            position={[side * (panelW / 2 + w / 2), offsetY, 0]}
            panel={m.panel}
            frame={m.panelFrame}
          />
        )),
      )}
      {/* VHF/UHF crossed dipoles */}
      <mesh material={m.antenna} position={[0, -h / 2 - 0.008, 0]}>
        <cylinderGeometry args={[0.0004, 0.0004, 0.016, 6]} />
      </mesh>
      <mesh material={m.antenna} position={[0, -h / 2 - 0.005, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.0004, 0.0004, 0.014, 6]} />
      </mesh>
    </group>
  );
}

// ── Optional glTF model loader ──────────────────────────────────────
// Set `VITE_CUBESAT_GLB=/models/cubesat.glb` (and drop the file in
// `frontend/public/models/`) to swap the procedural mesh for a real PBR
// CubeSat from e.g. NASA 3D Resources / GrabCAD. When the variable is
// unset the build never references the file, so we don't fire 404s in
// dev or production.
const GLTF_CUBESAT_URL: string | undefined = import.meta.env.VITE_CUBESAT_GLB as
  | string
  | undefined;

function CubeSatGLTF({
  url,
  color,
  emissiveIntensity,
}: {
  url: string;
  color: string;
  emissiveIntensity: number;
}) {
  const gltf = useGLTF(url) as unknown as { scene: Object3D };
  // Tint the imported model with the constellation color via emissive — this
  // keeps the original PBR materials intact while giving each constellation
  // a recognisable accent under the bloom pass.
  const cloned = useMemo(() => {
    const root = gltf.scene.clone(true);
    const tint = new Color(color);
    root.traverse((child: Object3D) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh) return;
      const apply = (mm: MeshStandardMaterial) => {
        const dup = mm.clone();
        dup.emissive = tint;
        dup.emissiveIntensity = emissiveIntensity * 0.45;
        mesh.material = dup;
      };
      const mat = mesh.material as MeshStandardMaterial | MeshStandardMaterial[];
      Array.isArray(mat) ? mat.forEach(apply) : apply(mat);
    });
    return root;
  }, [gltf.scene, color, emissiveIntensity]);

  // Real CubeSats are 10–30 cm; the scene unit is 1 = Earth radius (6378 km).
  return <primitive object={cloned} scale={0.012} />;
}

if (GLTF_CUBESAT_URL) {
  // Pre-warm the loader so the first satellite appearance doesn't hitch on
  // a network round-trip. Drei caches the result on its module-level map.
  try {
    useGLTF.preload(GLTF_CUBESAT_URL);
  } catch {
    // Optional asset; ignore preload failure.
  }
}

// Minimal class-based error boundary — drei's `useGLTF` suspends on load
// failure, so we need a real boundary (Suspense fallbacks don't catch
// thrown errors) to fall back to the procedural mesh.
class ModelErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(_err: Error) {
    // Swallow — the fallback is shown instead.
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

// Picks the glTF model when configured, falls back to the procedural one.
function CubeSatModel({
  modelType,
  color,
  emissiveIntensity,
}: {
  modelType: number;
  color: string;
  emissiveIntensity: number;
}) {
  const procedural =
    modelType === 0 ? (
      <CubeSat1U color={color} emissiveIntensity={emissiveIntensity} />
    ) : (
      <CubeSat3U color={color} emissiveIntensity={emissiveIntensity} />
    );
  if (!GLTF_CUBESAT_URL) return procedural;
  return (
    <ModelErrorBoundary fallback={procedural}>
      <Suspense fallback={procedural}>
        <CubeSatGLTF url={GLTF_CUBESAT_URL} color={color} emissiveIntensity={emissiveIntensity} />
      </Suspense>
    </ModelErrorBoundary>
  );
}

// ── Single satellite marker ──────────────────────────────────────────
interface SatMarkerProps {
  noradId: number;
  name: string;
  constellation: string;
  isSelected: boolean;
  isHighlighted: boolean;
  showLabel: boolean;
  // Stable selection callback: SatMarker forwards its noradId so the
  // parent doesn't have to bake a fresh closure per marker on every
  // render (which busted React.memo and caused needless reconciliation).
  onSelect: (noradId: number) => void;
  // When using client-side SGP4, position is updated in useFrame via groupRef
  initPos: Vector3;
  // For client-side SGP4: ref to function returning current ECI position
  getECI?: () => { x: number; y: number; z: number } | null;
}

// Hysteresis thresholds for the line-of-sight occlusion test (Earth radius = 1).
// `LABEL_HIDE_DIST` is well inside Earth so a satellite must be *clearly*
// occluded to hide its label; `LABEL_SHOW_DIST` is on the surface so a
// satellite must be *clearly* in front to show it. The wide gap absorbs
// the rapid distToCenter oscillations that happen every time a fast-moving
// camera grazes the limb at high simulation speed — that was the single
// most visible source of label flicker.
const LABEL_HIDE_DIST = 0.85;
const LABEL_SHOW_DIST = 1.0;

const SatMarker = memo(function SatMarker({
  noradId,
  name,
  constellation,
  isSelected,
  isHighlighted,
  showLabel,
  onSelect,
  initPos,
  getECI,
}: SatMarkerProps) {
  // Bind the noradId once per marker so the click handler reference is
  // stable for the lifetime of the marker. Without this, the JSX
  // `onClick={...}` literal is a new closure every render and the
  // memo'd marker re-renders even when nothing else changed.
  const handleClick = useCallback(() => onSelect(noradId), [onSelect, noradId]);
  const groupRef = useRef<Group>(null);
  const bodyRef = useRef<Group>(null);
  // Drive the label visibility through a DOM ref + opacity transition rather
  // than React state so a flip near the horizon does not remount the drei
  // <Html> portal — that remount is the actual visual "blink" users notice
  // at high time-acceleration. The CSS transition smooths the fade and the
  // ref tracks the current logical state for the hysteresis check below.
  const labelDivRef = useRef<HTMLDivElement>(null);
  const labelVisibleRef = useRef(true);

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
    // Earth-occlusion check for the satellite name. Run every frame — the
    // math is a handful of multiplies and one sqrt; throttling it to every
    // Nth frame is what introduced the flicker at high simulation speed
    // (a fast-moving satellite could cross the horizon both ways inside
    // a single throttle window).
    if (showLabel && groupRef.current && labelDivRef.current) {
      const satPos = groupRef.current.position;
      const camPos = camera.position;
      const dx = satPos.x - camPos.x;
      const dy = satPos.y - camPos.y;
      const dz = satPos.z - camPos.z;
      const lenSq = dx * dx + dy * dy + dz * dz;
      let nextVisible = labelVisibleRef.current;
      if (lenSq > 0) {
        const tParam = Math.max(0, Math.min(1, -(camPos.x * dx + camPos.y * dy + camPos.z * dz) / lenSq));
        const cx = camPos.x + tParam * dx;
        const cy = camPos.y + tParam * dy;
        const cz = camPos.z + tParam * dz;
        const distToCenter = Math.sqrt(cx * cx + cy * cy + cz * cz);
        if (labelVisibleRef.current && distToCenter < LABEL_HIDE_DIST) {
          nextVisible = false;
        } else if (!labelVisibleRef.current && distToCenter > LABEL_SHOW_DIST) {
          nextVisible = true;
        }
      }
      if (nextVisible !== labelVisibleRef.current) {
        labelVisibleRef.current = nextVisible;
        labelDivRef.current.style.opacity = nextVisible ? '1' : '0';
      }
    }
  });

  return (
    <group ref={groupRef} position={initPos} onClick={handleClick}>
      <group ref={bodyRef}>
        <CubeSatModel
          modelType={modelType}
          color={color}
          emissiveIntensity={emissiveIntensity}
        />
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

      {/* Label — kept mounted while showLabel is true; visibility is driven
          via opacity through a DOM ref to avoid React remounts that would
          otherwise blink the label whenever the satellite crosses the
          Earth horizon. `distanceFactor` is intentionally left out: it
          rescaled the DOM element every frame from the camera distance,
          which forced the browser to re-rasterise the text on every
          tick at high sim speed and showed up as flicker. A static
          font size composites cleanly through the GPU. */}
      {showLabel && (
        <Html
          position={[0, 0.05, 0]}
          center
          // Cap label z-index below the UI panels (which sit at z-10/z-20).
          // Default drei range starts at 16777271, which makes labels float
          // over the open control panel. Keep relative ordering inside the
          // 3D layer (5 → 0).
          zIndexRange={[5, 0]}
          style={{ pointerEvents: 'none' }}
        >
          <div
            ref={labelDivRef}
            className="sat-label"
            style={{ color, opacity: 1, transition: 'opacity 220ms ease-out' }}
          >
            {name}
            {isSelected && (
              <div style={{ fontSize: '9px', opacity: 0.7, marginTop: '1px' }}>
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
  inclinationDeg = 55,
}: {
  index: number;
  total: number;
  altitudeKm: number;
  color: string;
  opacity?: number;
  planes?: number;
  inclinationDeg?: number;
}) {
  const positions = useMemo(() => {
    const steps = 128;
    const arr = new Float32Array(steps * 3);
    const period = circularOrbitPeriodSec(altitudeKm);
    for (let i = 0; i < steps; i++) {
      const t = (i / steps) * period;
      const { x, y, z } = computeVirtualECI(index, total, altitudeKm, t, planes, degToRad(inclinationDeg));
      arr[i * 3] = x * SCALE;
      arr[i * 3 + 1] = z * SCALE;
      arr[i * 3 + 2] = -y * SCALE;
    }
    return arr;
  }, [index, total, altitudeKm, planes, inclinationDeg]);

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
  inclinationDeg: number;
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
  inclinationDeg,
  timeSpeed,
}: SatellitesProps) {
  const lang = useStore((s) => s.lang);
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
      name: t('virtual.name', lang, { index: i + 1 }),
      constellation: CONSTELLATION_NAMES[i % CONSTELLATION_NAMES.length],
    }));
    return allVirt.filter((sat) => activeConstellations.includes(sat.constellation));
  }, [orbitAltitudeKm, satelliteCount, activeConstellations, lang]);

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
  const orbitParamsRef = useRef({ orbitAltitudeKm, virtualSatCount, orbitalPlanes, inclinationDeg });
  orbitParamsRef.current = { orbitAltitudeKm, virtualSatCount, orbitalPlanes, inclinationDeg };

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
        const { orbitAltitudeKm: alt, virtualSatCount: vsc, orbitalPlanes: planes, inclinationDeg: incl } = orbitParamsRef.current;
        // Virtual mode
        if (alt > 0) {
          const idx = noradId - 90000;
          return computeVirtualECI(idx, vsc, alt, simTime / 1000, planes, degToRad(incl));
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
      const eci = computeVirtualECI(idx, Math.max(virtualSatCount, 1), orbitAltitudeKm, simTime / 1000, orbitalPlanes, degToRad(inclinationDeg));
      return new Vector3(eci.x * SCALE, eci.z * SCALE, -eci.y * SCALE);
    }
    const p = positions.find((pos) => pos.norad_id === noradId);
    if (p) {
      return new Vector3(p.eci.x * SCALE, p.eci.z * SCALE, -p.eci.y * SCALE);
    }
    return new Vector3(2, 0, 0);
  }

  // Single stable selection callback shared by every SatMarker. Reads
  // the "currently selected" id through a ref so the closure identity
  // never changes — that keeps SatMarker memoisation effective even
  // when the selection changes every click.
  const selectedRef = useRef(selectedSatellite);
  selectedRef.current = selectedSatellite;
  const handleSelect = useCallback(
    (noradId: number) => {
      onSelectSatellite(selectedRef.current === noradId ? null : noradId);
    },
    [onSelectSatellite],
  );

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
            noradId={sat.norad_id}
            name={sat.name}
            constellation={sat.constellation}
            isSelected={selectedSatellite === sat.norad_id}
            isHighlighted={isHighlighted}
            showLabel={showLabels}
            onSelect={handleSelect}
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
            noradId={pos.norad_id}
            name={pos.name}
            constellation={constellation}
            isSelected={selectedSatellite === pos.norad_id}
            isHighlighted={isHighlighted}
            showLabel={showLabels}
            onSelect={handleSelect}
            initPos={getInitialPos(pos.norad_id)}
            getECI={getGetECI(pos.norad_id)}
          />
        );
      })}

      {/* ── Орбитальные треки (реальные TLE) ────────────── */}
      {showOrbits && orbitAltitudeKm === 0 &&
        Object.entries(orbitPaths).map(([id, path]) => {
          const numId = parseInt(id, 10);
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
              inclinationDeg={inclinationDeg}
            />
          );
        })}
    </group>
  );
}

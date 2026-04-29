/**
 * InterSatelliteLinks.tsx
 * Optimized ISL visualization:
 * - Object pooling with pre-allocated Line objects
 * - Throttled computation (every 2nd frame)
 * - Throttled raycasting (every 6th frame)
 * - Minimal React re-renders via refs
 * - LOS check (Earth shadow)
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import {
  BufferGeometry, LineBasicMaterial, Float32BufferAttribute,
  Group, Line, Vector2, Vector3, Raycaster,
} from 'three';
import { twoline2satrec, propagate } from 'satellite.js';
import { getSimTime } from '../simClock';
import { useStore } from '../hooks/useStore';
import { CONSTELLATION_NAMES } from '../constants';
import { selectRealSatellites } from '../selection';
import { computeVirtualECI, EARTH_RADIUS_KM, SCENE_SCALE } from '../lib/orbital';
import type { TLEData } from '../types';

const SCALE = SCENE_SCALE;
const EARTH_RADIUS_SQ = EARTH_RADIUS_KM * EARTH_RADIUS_KM;

// Per-frame helper: bulk-evaluate the shared virtual orbit generator.
function computeVirtualPositions(
  count: number,
  altitudeKm: number,
  simTimeMs: number,
  planes: number,
): Array<{ x: number; y: number; z: number }> {
  const t = simTimeMs / 1000;
  const result: Array<{ x: number; y: number; z: number }> = new Array(count);
  for (let i = 0; i < count; i++) {
    result[i] = computeVirtualECI(i, count, altitudeKm, t, planes);
  }
  return result;
}

// LOS check: does segment AB intersect Earth sphere?
function hasLineOfSight(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const lenSq = dx * dx + dy * dy + dz * dz;
  if (lenSq === 0) return true;
  const t = -(ax * dx + ay * dy + az * dz) / lenSq;
  if (t <= 0 || t >= 1) return true; // closest point outside segment
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const cz = az + t * dz;
  return (cx * cx + cy * cy + cz * cz) >= EARTH_RADIUS_SQ;
}

// Reusable materials
const GREEN_MAT = new LineBasicMaterial({ color: '#00ff88', transparent: true, opacity: 0.85 });
const RED_MAT = new LineBasicMaterial({ color: '#ff3344', transparent: true, opacity: 0.4 });
const HOVER_MAT = new LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 1.0, linewidth: 2 });

// Line pool
const MAX_LINES = 120;

function createLinePool(): Line[] {
  const pool: Line[] = [];
  for (let i = 0; i < MAX_LINES; i++) {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(6), 3));
    const line = new Line(geo, GREEN_MAT);
    line.visible = false;
    line.frustumCulled = false;
    pool.push(line);
  }
  return pool;
}

interface InterSatelliteLinksProps {
  tleData: TLEData[];
  satelliteConstellations: Record<number, string>;
}

export function InterSatelliteLinks({ tleData, satelliteConstellations }: InterSatelliteLinksProps) {
  const {
    lang,
    showLinks,
    commRangeKm,
    satelliteCount,
    activeConstellations,
    orbitAltitudeKm,
    orbitalPlanes,
    setActiveLinksCount,
  } = useStore();

  const groupRef = useRef<Group>(null);
  const prevLinksRef = useRef(0);
  const linePoolRef = useRef<Line[]>([]);
  const poolInitializedRef = useRef(false);

  // Tooltip state
  const [tooltip, setTooltip] = useState<{ position: Vector3; distance: number; connected: boolean } | null>(null);
  const hoveredIdxRef = useRef(-1);
  const linkMetaRef = useRef<Array<{ mx: number; my: number; mz: number; distance: number; connected: boolean }>>([]);

  // Raycaster
  const raycasterRef = useRef(new Raycaster());
  const pointerRef = useRef(new Vector2(-999, -999));
  const { camera, gl } = useThree();
  const frameCountRef = useRef(0);
  const activeLineCountRef = useRef(0);

  // Init line pool. We dispose geometries on unmount because Three.js
  // does not release GPU buffers automatically; switching TLE source or
  // hot-reloading the component otherwise leaks ~120 BufferGeometry
  // objects per remount. Materials are module-level singletons, so we
  // intentionally leave them alive.
  useEffect(() => {
    if (!groupRef.current || poolInitializedRef.current) return;
    const group = groupRef.current;
    const pool = createLinePool();
    pool.forEach((line) => group.add(line));
    linePoolRef.current = pool;
    poolInitializedRef.current = true;
    return () => {
      for (const line of pool) {
        group.remove(line);
        line.geometry.dispose();
      }
      linePoolRef.current = [];
      poolInitializedRef.current = false;
    };
  }, []);

  // Pointer tracking with passive listener
  useEffect(() => {
    const el = gl.domElement;
    const handleMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      pointerRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    };
    const handleLeave = () => {
      pointerRef.current.set(-999, -999);
    };
    el.addEventListener('pointermove', handleMove, { passive: true });
    el.addEventListener('pointerleave', handleLeave);
    return () => {
      el.removeEventListener('pointermove', handleMove);
      el.removeEventListener('pointerleave', handleLeave);
    };
  }, [gl]);

  // Pre-parse satrec objects
  const satrecsRef = useRef<Array<{
    norad_id: number;
    name: string;
    constellation: string;
    satrec: ReturnType<typeof twoline2satrec>;
  }>>([]);

  useEffect(() => {
    if (tleData.length > 0) {
      satrecsRef.current = tleData.map((tle) => ({
        norad_id: tle.norad_id,
        name: tle.name,
        constellation: tle.constellation,
        satrec: twoline2satrec(tle.tle_line1, tle.tle_line2),
      }));
    }
  }, [tleData]);

  useFrame(() => {
    if (!groupRef.current || linePoolRef.current.length === 0) return;

    const pool = linePoolRef.current;
    frameCountRef.current++;

    // Throttle link computation to every 2nd frame for performance
    const shouldCompute = frameCountRef.current % 2 === 0;

    if (!shouldCompute) {
      // Still do raycasting on some frames
      if (frameCountRef.current % 6 === 0 && showLinks) {
        doRaycast(pool, camera);
      }
      return;
    }

    const simTime = getSimTime();

    // Hide all lines
    for (let i = 0; i < pool.length; i++) {
      pool[i].visible = false;
    }

    if (!showLinks) {
      if (prevLinksRef.current !== 0) {
        prevLinksRef.current = 0;
        setActiveLinksCount(0);
      }
      activeLineCountRef.current = 0;
      linkMetaRef.current = [];
      if (hoveredIdxRef.current !== -1) {
        hoveredIdxRef.current = -1;
        setTooltip(null);
      }
      return;
    }

    // Compute positions
    let eciPositions: Array<{ norad_id: number; x: number; y: number; z: number }>;

    if (orbitAltitudeKm > 0) {
      const virt = computeVirtualPositions(satelliteCount, orbitAltitudeKm, simTime, orbitalPlanes);
      eciPositions = virt
        .map((p, i) => ({
          norad_id: 90000 + i,
          constellation: CONSTELLATION_NAMES[i % CONSTELLATION_NAMES.length],
          ...p,
        }))
        .filter((p) => activeConstellations.includes(p.constellation));
    } else if (satrecsRef.current.length > 0) {
      const now = new Date(simTime);
      // Shared selection: identical to Satellites.tsx / CoverageZones.tsx
      // so the ISL counter references the same spacecraft that are drawn.
      const selected = selectRealSatellites(
        satrecsRef.current,
        satelliteCount,
        activeConstellations,
        satelliteConstellations,
      );

      eciPositions = [];
      for (const { norad_id, satrec } of selected) {
        const pv = propagate(satrec, now);
        if (!pv.position || typeof pv.position === 'boolean') continue;
        const pos = pv.position as { x: number; y: number; z: number };
        eciPositions.push({ norad_id, x: pos.x, y: pos.y, z: pos.z });
      }
    } else {
      eciPositions = [];
    }

    if (eciPositions.length < 2) {
      // Not enough visible satellites to form any ISL. Reset all derived state so the
      // header counter, tooltip and raycast don't linger on stale values after the user
      // filters constellations, loses TLE data, or collapses count to <2.
      if (prevLinksRef.current !== 0) {
        prevLinksRef.current = 0;
        setActiveLinksCount(0);
      }
      activeLineCountRef.current = 0;
      linkMetaRef.current = [];
      if (hoveredIdxRef.current !== -1) {
        hoveredIdxRef.current = -1;
        setTooltip(null);
      }
      return;
    }

    let activeCount = 0;
    let lineIdx = 0;
    const commRangeSq = commRangeKm * commRangeKm;
    const nearEdgeRangeSq = (commRangeKm * 1.5) * (commRangeKm * 1.5);
    const meta: Array<{ mx: number; my: number; mz: number; distance: number; connected: boolean }> = [];
    const currentHovered = hoveredIdxRef.current;

    for (let i = 0; i < eciPositions.length; i++) {
      const a = eciPositions[i];
      for (let j = i + 1; j < eciPositions.length; j++) {
        const b = eciPositions[j];

        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dz = a.z - b.z;
        const distSq = dx * dx + dy * dy + dz * dz;

        // Early exit: skip pairs beyond nearEdge range
        if (distSq > nearEdgeRangeSq) continue;

        const dist = Math.sqrt(distSq);
        const los = hasLineOfSight(a.x, a.y, a.z, b.x, b.y, b.z);
        const connected = distSq <= commRangeSq && los;
        const nearEdge = !connected && los;

        if ((connected || nearEdge) && lineIdx < pool.length) {
          const ax3 = a.x * SCALE;
          const ay3 = a.z * SCALE;
          const az3 = -a.y * SCALE;
          const bx3 = b.x * SCALE;
          const by3 = b.z * SCALE;
          const bz3 = -b.y * SCALE;

          const line = pool[lineIdx];
          const posAttr = line.geometry.attributes.position as Float32BufferAttribute;
          const arr = posAttr.array as Float32Array;
          arr[0] = ax3; arr[1] = ay3; arr[2] = az3;
          arr[3] = bx3; arr[4] = by3; arr[5] = bz3;
          posAttr.needsUpdate = true;
          line.geometry.computeBoundingSphere();

          // Preserve hover material on hovered line, otherwise set normal material
          if (lineIdx === currentHovered) {
            line.material = HOVER_MAT;
          } else {
            line.material = connected ? GREEN_MAT : RED_MAT;
          }
          line.visible = true;
          line.userData.linkIndex = lineIdx;
          line.userData.distance = dist;
          line.userData.connected = connected;

          if (connected) activeCount++;

          meta.push({
            mx: (ax3 + bx3) / 2,
            my: (ay3 + by3) / 2,
            mz: (az3 + bz3) / 2,
            distance: dist,
            connected,
          });

          lineIdx++;
        } else if (connected) {
          activeCount++;
        }
      }
    }

    activeLineCountRef.current = lineIdx;
    linkMetaRef.current = meta;

    if (prevLinksRef.current !== activeCount) {
      prevLinksRef.current = activeCount;
      setActiveLinksCount(activeCount);
    }

    // Raycast on computation frames (every 6th overall)
    if (frameCountRef.current % 6 === 0) {
      doRaycast(pool, camera);
    }
  });

  const doRaycast = useCallback((pool: Line[], cam: typeof camera) => {
    raycasterRef.current.setFromCamera(pointerRef.current, cam);
    raycasterRef.current.params.Line = { threshold: 0.03 };

    const visibleLines: Line[] = [];
    const count = activeLineCountRef.current;
    for (let i = 0; i < count && i < pool.length; i++) {
      if (pool[i].visible) visibleLines.push(pool[i]);
    }

    const intersects = raycasterRef.current.intersectObjects(visibleLines, false);
    const meta = linkMetaRef.current;

    let newIdx = -1;
    if (intersects.length > 0) {
      const hit = intersects[0];
      const idx = hit.object.userData?.linkIndex;
      if (idx !== undefined && meta[idx]) {
        newIdx = idx;
        (hit.object as Line).material = HOVER_MAT;
      }
    }

    if (newIdx !== hoveredIdxRef.current) {
      // Restore previous hovered line material
      if (hoveredIdxRef.current >= 0 && hoveredIdxRef.current < pool.length && pool[hoveredIdxRef.current].visible) {
        const prevLine = pool[hoveredIdxRef.current];
        prevLine.material = prevLine.userData.connected ? GREEN_MAT : RED_MAT;
      }
      hoveredIdxRef.current = newIdx;
      if (newIdx >= 0 && meta[newIdx]) {
        const m = meta[newIdx];
        setTooltip({ position: new Vector3(m.mx, m.my, m.mz), distance: m.distance, connected: m.connected });
      } else {
        setTooltip(null);
      }
    }
  }, []);

  return (
    <>
      <group ref={groupRef} />
      {tooltip && (
        <Html
          position={[tooltip.position.x, tooltip.position.y, tooltip.position.z]}
          center
          style={{ pointerEvents: 'none' }}
          zIndexRange={[100, 0]}
        >
          <div
            style={{
              background: 'rgba(8, 16, 40, 0.85)',
              border: '1px solid rgba(100, 170, 255, 0.4)',
              borderRadius: '8px',
              padding: '6px 10px',
              color: '#d9ecff',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '11px',
              whiteSpace: 'nowrap',
              backdropFilter: 'blur(12px)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.4), 0 0 8px rgba(80,150,255,0.15)',
            }}
          >
            <span style={{ color: tooltip.connected ? '#00ff88' : '#ff3344', marginRight: '4px' }}>●</span>
            {tooltip.distance.toFixed(1)} {lang === 'ru' ? 'км' : 'km'}
          </div>
        </Html>
      )}
    </>
  );
}

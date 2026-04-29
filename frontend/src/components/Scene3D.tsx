import { Suspense, useRef, useMemo, useEffect, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Stars, PerspectiveCamera } from '@react-three/drei';
import { Group, Vector3 } from 'three';
import { twoline2satrec, propagate } from 'satellite.js';
import { getSimTime } from '../simClock';
import { Earth, EARTH_ROTATION_SPEED } from './Earth';
import { Satellites } from './Satellites';
import { InterSatelliteLinks } from './InterSatelliteLinks';
import { CoverageZones } from './CoverageZones';
import { useStore } from '../hooks/useStore';
import { computeVirtualECI, SCENE_SCALE } from '../lib/orbital';
import type { SatellitePosition, OrbitPoint, TLEData } from '../types';

const CAM_SCALE = SCENE_SCALE;

// ── Coordinate grid (equator + latitude circles), rotates with Earth
function CoordinateGrid() {
  const groupRef = useRef<Group>(null);

  const lines = useMemo(() => {
    const result: [number, number, number][][] = [];

    // Equator
    const equator: [number, number, number][] = [];
    for (let i = 0; i <= 360; i += 2) {
      const rad = (i * Math.PI) / 180;
      equator.push([Math.cos(rad) * 1.002, 0, Math.sin(rad) * 1.002]);
    }
    result.push(equator);

    // Latitude circles
    for (const latDeg of [30, 60, -30, -60]) {
      const circle: [number, number, number][] = [];
      const latRad = (latDeg * Math.PI) / 180;
      const r = Math.cos(latRad) * 1.002;
      const y = Math.sin(latRad) * 1.002;
      for (let i = 0; i <= 360; i += 4) {
        const lonRad = (i * Math.PI) / 180;
        circle.push([r * Math.cos(lonRad), y, r * Math.sin(lonRad)]);
      }
      result.push(circle);
    }

    return result;
  }, []);

  // Rotate grid in sync with Earth so lat/lon lines stay aligned with the surface
  useFrame(() => {
    if (groupRef.current) {
      groupRef.current.rotation.y = EARTH_ROTATION_SPEED * (getSimTime() / 1000);
    }
  });

  return (
    <group ref={groupRef}>
      {lines.map((line, idx) => {
        const positions = new Float32Array(line.length * 3);
        line.forEach((p, i) => {
          positions[i * 3] = p[0];
          positions[i * 3 + 1] = p[1];
          positions[i * 3 + 2] = p[2];
        });
        return (
          <line key={idx}>
            <bufferGeometry>
              <bufferAttribute attach="attributes-position" args={[positions, 3]} />
            </bufferGeometry>
            <lineBasicMaterial color="#3389ff" transparent opacity={0.08} />
          </line>
        );
      })}
    </group>
  );
}

// ── Camera controller: satellite tracking ───────────────────────────
interface CameraControllerProps {
  tleData: TLEData[];
  orbitAltitudeKm: number;
  satelliteCount: number;
  orbitalPlanes: number;
  controlsRef: React.RefObject<any>;
}

function CameraController({ tleData, orbitAltitudeKm, satelliteCount, orbitalPlanes, controlsRef }: CameraControllerProps) {
  const { camera } = useThree();
  const { focusedSatellite, selectedSatellite, cameraFollowing, setCameraFollowing } = useStore();
  const prevDistRef = useRef<number>(0);
  const isAnimatingRef = useRef(false);
  const offsetRef = useRef(new Vector3(0, 0.3, 0.8));
  const prevCamRotRef = useRef<{ x: number; y: number; z: number }>({ x: 0, y: 0, z: 0 });

  const satrecsRef = useRef<Record<number, ReturnType<typeof twoline2satrec>>>({});

  useEffect(() => {
    const map: Record<number, ReturnType<typeof twoline2satrec>> = {};
    tleData.forEach((tle) => {
      map[tle.norad_id] = twoline2satrec(tle.tle_line1, tle.tle_line2);
    });
    satrecsRef.current = map;
  }, [tleData]);

  // When the tracked satellite is no longer available (TLE dropped,
  // user switched to virtual mode, archival spacecraft, etc.) drop the
  // follow state cleanly so the camera returns to the Earth target
  // instead of staying "stuck" on a ghost.
  useEffect(() => {
    const id = focusedSatellite ?? selectedSatellite;
    if (id == null) return;
    const inVirtualMode = orbitAltitudeKm > 0;
    const isVirtualId = id >= 90000;
    if (inVirtualMode !== isVirtualId) {
      setCameraFollowing(false);
      if (controlsRef.current) controlsRef.current.target.set(0, 0, 0);
      return;
    }
    if (!isVirtualId && !satrecsRef.current[id]) {
      setCameraFollowing(false);
      if (controlsRef.current) controlsRef.current.target.set(0, 0, 0);
    }
  }, [focusedSatellite, selectedSatellite, orbitAltitudeKm, tleData, setCameraFollowing, controlsRef]);

  // Get current ECI position for any satellite id
  const getSatPosition = useCallback((id: number): Vector3 | null => {
    const simTime = getSimTime();
    if (orbitAltitudeKm > 0 && id >= 90000) {
      const idx = id - 90000;
      const eci = computeVirtualECI(idx, satelliteCount, orbitAltitudeKm, simTime / 1000, orbitalPlanes);
      return new Vector3(eci.x * CAM_SCALE, eci.z * CAM_SCALE, -eci.y * CAM_SCALE);
    }
    const satrec = satrecsRef.current[id];
    if (!satrec) return null;
    const pv = propagate(satrec, new Date(simTime));
    if (!pv.position || typeof pv.position === 'boolean') return null;
    const pos = pv.position as { x: number; y: number; z: number };
    return new Vector3(pos.x * CAM_SCALE, pos.z * CAM_SCALE, -pos.y * CAM_SCALE);
  }, [orbitAltitudeKm, satelliteCount, orbitalPlanes]);

  // Start animation when focus or selection changes
  useEffect(() => {
    const id = focusedSatellite ?? selectedSatellite;
    if (id == null) {
      isAnimatingRef.current = false;
      return;
    }
    if (cameraFollowing) {
      isAnimatingRef.current = true;
      prevDistRef.current = camera.position.length();
      prevCamRotRef.current = { x: camera.rotation.x, y: camera.rotation.y, z: camera.rotation.z };
    }
  }, [focusedSatellite, selectedSatellite, cameraFollowing]);

  // Reset orbit target to Earth center when follow is disabled via store
  useEffect(() => {
    if (!cameraFollowing) {
      isAnimatingRef.current = false;
      if (controlsRef.current) {
        controlsRef.current.target.set(0, 0, 0);
      }
    }
  }, [cameraFollowing]);

  useFrame(() => {
    const id = cameraFollowing ? (focusedSatellite ?? selectedSatellite) : null;

    // Detect user interaction to break follow: zoom-out or significant rotation
    if (cameraFollowing && id != null) {
      const currentDist = camera.position.length();
      // Zoom-out detection
      if (prevDistRef.current > 0 && currentDist > prevDistRef.current + 0.3) {
        setCameraFollowing(false);
        isAnimatingRef.current = false;
        // Reset orbit target to Earth center so user rotates around Earth
        if (controlsRef.current) {
          controlsRef.current.target.set(0, 0, 0);
        }
        return;
      }
      // Rotation detection — significant user drag breaks follow
      const rotDelta = Math.abs(camera.rotation.x - prevCamRotRef.current.x)
        + Math.abs(camera.rotation.y - prevCamRotRef.current.y);
      if (!isAnimatingRef.current && rotDelta > 0.15) {
        setCameraFollowing(false);
        isAnimatingRef.current = false;
        // Reset orbit target to Earth center so user rotates around Earth
        if (controlsRef.current) {
          controlsRef.current.target.set(0, 0, 0);
        }
        return;
      }
      prevDistRef.current = currentDist;
      prevCamRotRef.current = { x: camera.rotation.x, y: camera.rotation.y, z: camera.rotation.z };
    }

    if (!isAnimatingRef.current && !cameraFollowing) return;

    const targetId = focusedSatellite ?? selectedSatellite;
    if (targetId == null) return;

    const satPos = getSatPosition(targetId);
    if (!satPos) return;

    // Camera target: offset from satellite in outward direction
    const dir = satPos.clone().normalize();
    const camTarget = satPos.clone().add(dir.multiplyScalar(0.6)).add(offsetRef.current);

    if (isAnimatingRef.current) {
      camera.position.lerp(camTarget, 0.06);
      camera.lookAt(satPos);
      if (controlsRef.current) {
        controlsRef.current.target.lerp(satPos, 0.06);
      }
      if (camera.position.distanceTo(camTarget) < 0.05) {
        isAnimatingRef.current = false;
        prevCamRotRef.current = { x: camera.rotation.x, y: camera.rotation.y, z: camera.rotation.z };
      }
    } else if (cameraFollowing) {
      // Continuous follow — smooth tracking
      camera.position.lerp(camTarget, 0.03);
      if (controlsRef.current) {
        controlsRef.current.target.lerp(satPos, 0.05);
      }
    }
  });

  return null;
}

// ── Main 3D scene ───────────────────────────────────────────────────
interface SceneContentProps {
  positions: SatellitePosition[];
  tleData: TLEData[];
  orbitPaths: Record<number, OrbitPoint[]>;
  satelliteConstellations: Record<number, string>;
}

function SceneContent({ positions, tleData, orbitPaths, satelliteConstellations }: SceneContentProps) {
  const {
    timeSpeed,
    showOrbits,
    showLabels,
    selectedSatellite,
    highlightedConstellation,
    activeConstellations,
    satelliteCount,
    orbitAltitudeKm,
    orbitalPlanes,
    selectSatellite,
  } = useStore();

  const controlsRef = useRef<any>(null);

  return (
    <>
      {/* Camera */}
      <PerspectiveCamera makeDefault position={[0, 2, 4]} fov={50} near={0.01} far={1000} />
      <OrbitControls
        ref={controlsRef}
        enablePan={false}
        minDistance={1.5}
        maxDistance={20}
        rotateSpeed={0.5}
        zoomSpeed={0.8}
        enableDamping
        dampingFactor={0.05}
      />

      {/* Camera controller: satellite tracking */}
      <CameraController
        tleData={tleData}
        orbitAltitudeKm={orbitAltitudeKm}
        satelliteCount={satelliteCount}
        orbitalPlanes={orbitalPlanes}
        controlsRef={controlsRef}
      />

      {/* Lighting */}
      <ambientLight intensity={0.35} color="#a8d4ff" />
      <directionalLight position={[5, 3, 5]} intensity={1.8} color="#ffffff" />
      <directionalLight position={[-3, -1, -3]} intensity={0.5} color="#5599dd" />
      <directionalLight position={[0, 5, -3]} intensity={0.4} color="#ffffff" />
      <pointLight position={[0, 0, 0]} intensity={0.15} color="#5599dd" distance={10} />

      {/* Stars — reduced count for performance */}
      <Stars radius={100} depth={80} count={1500} factor={3} saturation={0.1} fade speed={0.5} />

      {/* Earth with NASA Blue Marble */}
      <Earth />

      {/* Coordinate grid */}
      <CoordinateGrid />

      {/* Satellites */}
      <Satellites
        positions={positions}
        tleData={tleData}
        orbitPaths={orbitPaths}
        selectedSatellite={selectedSatellite}
        highlightedConstellation={highlightedConstellation}
        activeConstellations={activeConstellations}
        showOrbits={showOrbits}
        showLabels={showLabels}
        onSelectSatellite={selectSatellite}
        satelliteConstellations={satelliteConstellations}
        satelliteCount={satelliteCount}
        orbitAltitudeKm={orbitAltitudeKm}
        orbitalPlanes={orbitalPlanes}
        timeSpeed={timeSpeed}
      />

      {/* Inter-satellite links */}
      <InterSatelliteLinks
        tleData={tleData}
        satelliteConstellations={satelliteConstellations}
      />

      {/* Satellite coverage zones */}
      <CoverageZones
        positions={positions}
        tleData={tleData}
        satelliteConstellations={satelliteConstellations}
      />
    </>
  );
}

// ── Exported Canvas ─────────────────────────────────────────────────
interface Scene3DProps {
  positions: SatellitePosition[];
  tleData: TLEData[];
  orbitPaths: Record<number, OrbitPoint[]>;
  satelliteConstellations: Record<number, string>;
}

export function Scene3D({ positions, tleData, orbitPaths, satelliteConstellations }: Scene3DProps) {
  return (
    <div className="absolute inset-0">
      <Canvas
        gl={{ antialias: true, alpha: false }}
        style={{ background: '#050a18' }}
        dpr={[1, 1.5]}
      >
        <Suspense fallback={null}>
          <SceneContent
            positions={positions}
            tleData={tleData}
            orbitPaths={orbitPaths}
            satelliteConstellations={satelliteConstellations}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}

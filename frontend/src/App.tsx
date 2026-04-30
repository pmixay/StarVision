import { lazy, Suspense, useEffect, useMemo, useCallback, useRef } from 'react';
import { ControlPanel } from './components/ControlPanel';
import { SatelliteInfoPanel } from './components/SatelliteInfoPanel';
import { StarAIChat } from './components/StarAIChat';
import { Header } from './components/Header';
import { ErrorToast } from './components/ErrorToast';
import { EventLog } from './components/EventLog';
import { MissionDashboard } from './components/MissionDashboard';
import { CollisionPanel } from './components/CollisionPanel';
import { OptimizerPanel } from './components/OptimizerPanel';
import { useStore } from './hooks/useStore';
import {
  fetchSatellites, fetchPositions, fetchOrbitPath, fetchAllOrbitPaths,
  fetchTLE, fetchHealth, ApiError,
} from './services/api';
import { getSimTime } from './simClock';
import { CONSTELLATION_NAMES } from './constants';
import { t } from './i18n';

const Scene3D = lazy(() =>
  import('./components/Scene3D').then((mod) => ({ default: mod.Scene3D })),
);

export default function App() {
  const {
    lang,
    satellites, setSatellites,
    positions, setPositions,
    orbitPaths, setOrbitPath,
    tleData, setTleData,
    setTleMeta,
    setOrbitPaths,
    setBackendHealth,
    pushToast,
    logEvent,
    timeSpeed,
    selectedSatellite,
    activeLinksCount,
    satelliteCount,
    orbitAltitudeKm,
    activeConstellations,
    tleSource,
    backendReachable,
  } = useStore();

  const reachableRef = useRef(backendReachable);
  reachableRef.current = backendReachable;

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load satellite list
  useEffect(() => {
    fetchSatellites()
      .then((res) => setSatellites(res.satellites))
      .catch((err) => {
        const detail = err instanceof ApiError ? err.detail : String(err);
        pushToast({ level: 'error', title: t('event.apiError', lang), detail });
        logEvent({ level: 'error', kind: 'api_error', message: 'fetchSatellites failed', details: detail });
      });
  }, [setSatellites, pushToast, logEvent, lang]);

  // Load TLE for client-side SGP4
  useEffect(() => {
    fetchTLE()
      .then((res) => {
        setTleData(res.tle_data);
        setTleMeta(res.meta);
        if (res.meta.effective_source === 'embedded_fallback') {
          pushToast({
            level: 'warning',
            title: t('event.tleFallback', lang),
            detail: `${res.meta.total} embedded`,
          });
          logEvent({ level: 'warning', kind: 'tle_fallback', message: t('event.tleFallback', lang) });
        } else {
          logEvent({
            level: 'info',
            kind: 'tle_loaded',
            message: `${t('event.tleLoaded', lang)}: ${res.meta.effective_source}`,
            details: `${res.meta.total} TLE`,
          });
        }
      })
      .catch((err) => {
        const detail = err instanceof ApiError ? err.detail : String(err);
        pushToast({ level: 'error', title: t('event.apiError', lang), detail });
        logEvent({ level: 'error', kind: 'api_error', message: 'fetchTLE failed', details: detail });
      });
    // deliberately run once on mount; locale changes don't require refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Health polling — lightweight, kicks the status indicator.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const h = await fetchHealth();
        if (cancelled) return;
        setBackendHealth(h, true);
        if (!reachableRef.current) {
          logEvent({ level: 'success', kind: 'health_restored', message: t('event.healthRestored', lang) });
          pushToast({ level: 'success', title: t('event.healthRestored', lang) });
        }
      } catch (err) {
        if (cancelled) return;
        setBackendHealth(null, false);
        if (reachableRef.current) {
          const detail = err instanceof ApiError ? err.detail : String(err);
          logEvent({ level: 'error', kind: 'health_degraded', message: t('event.healthDegraded', lang), details: detail });
          pushToast({ level: 'error', title: t('event.healthDegraded', lang), detail });
        }
      }
    };
    tick();
    const id = setInterval(tick, 20000);
    return () => { cancelled = true; clearInterval(id); };
  }, [setBackendHealth, pushToast, logEvent, lang]);

  // Load positions (periodic — fallback for info panel).
  // Use simulated time to stay in sync with the 3D scene.
  const loadPositions = useCallback(async () => {
    try {
      const simTimestamp = new Date(getSimTime()).toISOString();
      const res = await fetchPositions(simTimestamp, tleSource);
      setPositions(res.positions);
    } catch (err) {
      // Don't spam toasts on every tick — just log. Health polling surfaces
      // actual backend outages with a single banner.
      if (!(err instanceof ApiError)) return;
    }
  }, [tleSource, setPositions]);

  useEffect(() => {
    loadPositions();
    // Slow polling — client-side SGP4 provides smooth animation
    // Minimum interval increased to reduce backend load
    const ms = Math.max(5000, 10000 / timeSpeed);
    intervalRef.current = setInterval(loadPositions, ms);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [timeSpeed, loadPositions]);

  // Load orbit when a satellite is selected (skip virtual NORAD 90000+).
  // Archival satellites return 409 from the backend — swallow that silently
  // (the UI already marks them as archival; a toast would be noise).
  useEffect(() => {
    if (selectedSatellite && selectedSatellite < 90000 && !orbitPaths[selectedSatellite]) {
      fetchOrbitPath(selectedSatellite, 180, 60, tleSource)
        .then((res) => setOrbitPath(res.norad_id, res.path))
        .catch((err) => {
          if (err instanceof ApiError && err.status === 409) return;
          const detail = err instanceof ApiError ? err.detail : String(err);
          logEvent({ level: 'warning', kind: 'api_error', message: 'orbit fetch failed', details: detail });
        });
    }
  }, [selectedSatellite, tleSource, orbitPaths, setOrbitPath, logEvent]);

  // Preload orbits for all operational satellites in a single round-trip.
  // Re-fetches when TLE source changes so tracks stay consistent with live data.
  // Replaces the old N×fetchOrbitPath fan-out — that flow was the dominant
  // cost when switching to CelesTrak (15 round-trips serialised in batches).
  useEffect(() => {
    if (satellites.length === 0) return;
    let cancelled = false;
    fetchAllOrbitPaths(120, 60, tleSource)
      .then((res) => {
        if (cancelled) return;
        const paths: Record<number, typeof res.paths[number]> = {};
        for (const [k, v] of Object.entries(res.paths)) paths[Number(k)] = v;
        setOrbitPaths(paths);
      })
      .catch((err) => {
        if (cancelled) return;
        const detail = err instanceof ApiError ? err.detail : String(err);
        logEvent({ level: 'warning', kind: 'api_error', message: 'orbits batch fetch failed', details: detail });
      });
    return () => { cancelled = true; };
  }, [satellites, tleSource, setOrbitPaths, logEvent]);

  // Map norad_id → constellation
  const satelliteConstellations = useMemo(() => {
    const map: Record<number, string> = {};
    satellites.forEach((s) => (map[s.norad_id] = s.constellation));
    return map;
  }, [satellites]);

  // Count displayed satellites based on mode (virtual / real)
  const displayedCount = useMemo(() => {
    if (orbitAltitudeKm > 0) {
      // Virtual mode: all satelliteCount are "active", filtered by constellations
      let count = 0;
      for (let i = 0; i < satelliteCount; i++) {
        if (activeConstellations.includes(CONSTELLATION_NAMES[i % CONSTELLATION_NAMES.length])) count++;
      }
      return count;
    }
    // Real mode: filter by active constellations, then take up to satelliteCount
    const filtered = positions.filter((p) => {
      const c = satelliteConstellations[p.norad_id];
      return activeConstellations.includes(c);
    });
    return Math.min(satelliteCount, filtered.length);
  }, [orbitAltitudeKm, satelliteCount, activeConstellations, positions, satelliteConstellations]);

  const activeCount = useMemo(() => {
    if (orbitAltitudeKm > 0) return displayedCount;
    // In real mode, count active satellites among the displayed set
    const filtered = positions.filter((p) => {
      const c = satelliteConstellations[p.norad_id];
      return activeConstellations.includes(c);
    });
    const displayed = filtered.slice(0, satelliteCount);
    return displayed.filter(p => {
      const sat = satellites.find(s => s.norad_id === p.norad_id);
      return sat?.status === 'active';
    }).length;
  }, [orbitAltitudeKm, displayedCount, positions, satelliteConstellations, activeConstellations, satelliteCount, satellites]);

  return (
    <div className="relative w-full h-full">
      {/* 3D Canvas */}
      <Suspense fallback={<div className="absolute inset-0 bg-[#050a18]" />}>
        <Scene3D
          positions={positions}
          tleData={tleData}
          orbitPaths={orbitPaths}
          satelliteConstellations={satelliteConstellations}
        />
      </Suspense>

      {/* Header */}
      <Header
        satelliteCount={displayedCount}
        activeCount={activeCount}
        timeSpeed={timeSpeed}
        activeLinksCount={activeLinksCount}
      />

      {/* UI Panels */}
      <ControlPanel />
      <SatelliteInfoPanel satellites={satellites} positions={positions} />

      {/* Engineering panels — docked on the right, above the StarAI
          chat button. The viewport ceiling keeps them below the Header
          on phones (where the header wraps to two rows) so they never
          spill behind it. */}
      <div className="absolute bottom-20 sm:bottom-24 right-2 sm:right-4 z-10 flex flex-col gap-2 items-end pointer-events-none max-h-[calc(100vh-160px)] overflow-y-auto sm:overflow-visible">
        <MissionDashboard
          displayedCount={displayedCount}
          activeCount={activeCount}
        />
        <CollisionPanel />
        <OptimizerPanel />
        <EventLog />
      </div>

      <StarAIChat />
      <ErrorToast />
    </div>
  );
}

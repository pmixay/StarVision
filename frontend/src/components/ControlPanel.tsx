import { useState } from 'react';
import { useStore } from '../hooks/useStore';
import { t, tConstellation } from '../i18n';
import { fetchTLE, refreshTLE, ApiError } from '../services/api';
import { CONSTELLATION_COLORS } from '../constants';

const SPEED_PRESETS = [
  { label: '1×', value: 1 },
  { label: '10×', value: 10 },
  { label: '50×', value: 50 },
  { label: '100×', value: 100 },
  { label: '200×', value: 200 },
];

export function ControlPanel() {
  const {
    lang,
    timeSpeed, setTimeSpeed,
    showOrbits, setShowOrbits,
    showLabels, setShowLabels,
    showLinks, setShowLinks,
    showCoverage, setShowCoverage,
    activeConstellations, toggleConstellation,
    satelliteCount, setSatelliteCount,
    tleSource, setTleSource,
    orbitAltitudeKm, setOrbitAltitudeKm,
    commRangeKm, setCommRangeKm,
    orbitalPlanes, setOrbitalPlanes,
    setTleData,
    setTleMeta,
    pushToast,
    logEvent,
    tleMeta,
    resetView,
  } = useStore();

  const [tleLoading, setTleLoading] = useState(false);

  const _applyTleResponse = (
    requested: 'embedded' | 'celestrak',
    res: Awaited<ReturnType<typeof fetchTLE>>,
    opts: { refreshed?: boolean } = {},
  ) => {
    setTleData(res.tle_data);
    setTleMeta(res.meta);
    // Commit the source choice only after a successful response. This prevents
    // the UI from flipping to "CelesTrak" while the fetch is still in flight or
    // ultimately fails.
    setTleSource(requested);

    const eff = res.meta.effective_source;
    if (requested === 'celestrak' && eff === 'embedded_fallback') {
      pushToast({
        level: 'warning',
        title: t('event.tleFallback', lang),
        detail: t('control.tleFallbackDetail', lang),
      });
      logEvent({ level: 'warning', kind: 'tle_fallback', message: t('event.tleFallback', lang) });
    } else if (eff === 'celestrak_partial') {
      pushToast({
        level: 'warning',
        title: t('event.tlePartial', lang),
        detail: `${res.meta.fallback_count} / ${res.meta.total} embedded`,
      });
      logEvent({
        level: 'warning',
        kind: 'tle_fallback',
        message: t('event.tlePartial', lang),
        details: `${res.meta.fallback_count}/${res.meta.total}`,
      });
    } else if (opts.refreshed) {
      pushToast({
        level: 'success',
        title: t('event.tleRefreshed', lang),
        detail: `${res.meta.live_count}/${res.meta.total} live`,
      });
      logEvent({
        level: 'success',
        kind: 'tle_refresh',
        message: t('event.tleRefreshed', lang),
        details: `${res.meta.live_count}/${res.meta.total}`,
      });
    } else {
      logEvent({
        level: 'info',
        kind: 'tle_source_switched',
        message: `${t('event.tleLoaded', lang)}: ${eff}`,
        details: `${res.meta.total} TLE`,
      });
    }
  };

  const handleTleSourceChange = async (source: 'embedded' | 'celestrak') => {
    if (tleLoading || tleSource === source) return;
    setTleLoading(true);
    try {
      const res = await fetchTLE(source);
      _applyTleResponse(source, res);
    } catch (err) {
      const detail = err instanceof ApiError ? err.detail : String(err);
      pushToast({
        level: 'error',
        title: t('event.apiError', lang),
        detail,
      });
      logEvent({ level: 'error', kind: 'api_error', message: 'fetchTLE failed', details: detail });
      // Intentionally keep current tleSource/data on failure.
    } finally {
      setTleLoading(false);
    }
  };

  const handleTleRefresh = async () => {
    if (tleLoading) return;
    setTleLoading(true);
    try {
      const res = await refreshTLE();
      _applyTleResponse('celestrak', res, { refreshed: true });
    } catch (err) {
      const detail = err instanceof ApiError ? err.detail : String(err);
      pushToast({
        level: 'error',
        title: t('event.apiError', lang),
        detail,
      });
      logEvent({ level: 'error', kind: 'api_error', message: 'refreshTLE failed', details: detail });
    } finally {
      setTleLoading(false);
    }
  };

  const planesWord = lang === 'ru'
    ? (orbitalPlanes === 1 ? t('control.plane_one', lang) : orbitalPlanes < 5 ? t('control.plane_few', lang) : t('control.plane_many', lang))
    : t(orbitalPlanes === 1 ? 'control.plane_one' : 'control.plane_many', lang);

  return (
    <div
      className="glass-panel absolute top-4 left-4 w-72 max-w-[92vw] p-4 animate-slide-left z-10 overflow-y-auto overflow-x-hidden"
      style={{ animationDelay: '0.2s', animationFillMode: 'both', maxHeight: 'calc(100vh - 80px)' }}
    >
      {/* Title */}
      <div className="flex items-center gap-2 mb-4">
        <div className="w-2 h-2 rounded-full bg-star-400 animate-pulse-glow" />
        <h2 className="font-display font-bold text-star-200 text-sm tracking-wider uppercase">
          {t('control.title', lang)}
        </h2>
      </div>

      {/* Simulation speed */}
      <div className="mb-4">
        <label className="block text-xs text-star-400 font-mono mb-2">
          {t('control.simSpeed', lang)}: {timeSpeed}×
        </label>
        <div className="flex gap-1 flex-wrap">
          {SPEED_PRESETS.map((preset) => (
            <button
              key={preset.value}
              onClick={() => setTimeSpeed(preset.value)}
              className={`btn-star text-[10px] flex-1 min-w-[40px] py-1.5 ${
                timeSpeed === preset.value ? 'active' : ''
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Satellite count */}
      <div className="mb-4">
        <label className="block text-xs text-star-400 font-mono mb-2">
          {t('control.satCount', lang)}: {satelliteCount}
        </label>
        <input
          type="range"
          min={3}
          max={15}
          step={1}
          value={satelliteCount}
          onChange={(e) => setSatelliteCount(Number(e.target.value))}
        />
        <div className="flex justify-between text-[10px] text-star-700 font-mono mt-0.5">
          <span>3</span>
          <span>15</span>
        </div>
      </div>

      {/* Orbit altitude */}
      <div className="mb-4">
        <label className="block text-xs text-star-400 font-mono mb-2">
          {t('control.orbitAlt', lang)}:{' '}
          <span className="text-star-200">
            {orbitAltitudeKm === 0
              ? t('control.realTLE', lang)
              : `${orbitAltitudeKm} ${lang === 'ru' ? 'км' : 'km'}`}
          </span>
        </label>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setOrbitAltitudeKm(0)}
            className={`btn-star text-[10px] px-2 py-1 flex-shrink-0 ${orbitAltitudeKm === 0 ? 'active' : ''}`}
          >
            TLE
          </button>
          <input
            type="range"
            min={400}
            max={2000}
            step={50}
            value={orbitAltitudeKm || 400}
            onChange={(e) => setOrbitAltitudeKm(Number(e.target.value))}
            className="flex-1"
          />
        </div>
        <div className="flex justify-between text-[10px] text-star-700 font-mono mt-0.5">
          <span>400 {lang === 'ru' ? 'км' : 'km'}</span>
          <span>1200</span>
          <span>2000 {lang === 'ru' ? 'км' : 'km'}</span>
        </div>
        {orbitAltitudeKm > 0 && (
          <p className="text-[9px] text-star-600 font-mono mt-1">
            {t('control.circularOrbits', lang)}: {satelliteCount} {t('header.spacecraft', lang)}, {orbitalPlanes} {planesWord}, 55°
          </p>
        )}
      </div>

      {/* TLE source (only in real TLE mode) */}
      {orbitAltitudeKm === 0 && (
        <div className="mb-4">
          <label className="block text-xs text-star-400 font-mono mb-2">
            {t('control.tleSource', lang)}
          </label>
          <div className="flex gap-1.5">
            <button
              onClick={() => handleTleSourceChange('embedded')}
              className={`btn-star text-[10px] flex-1 py-1.5 ${tleSource === 'embedded' ? 'active' : ''}`}
              disabled={tleLoading}
            >
              {t('control.tleEmbedded', lang)}
            </button>
            <button
              onClick={() => handleTleSourceChange('celestrak')}
              className={`btn-star text-[10px] flex-1 py-1.5 ${tleSource === 'celestrak' ? 'active' : ''}`}
              disabled={tleLoading}
            >
              {t('control.tleCelestrak', lang)}
            </button>
            {tleSource === 'celestrak' && (
              <button
                onClick={handleTleRefresh}
                className="btn-star text-[10px] px-2 py-1.5"
                disabled={tleLoading}
                title={t('control.tleRefresh', lang)}
              >
                {tleLoading ? '...' : '↻'}
              </button>
            )}
          </div>
          {tleLoading && (
            <p className="text-[9px] text-star-600 font-mono mt-1 animate-pulse">
              {t('control.tleLoading', lang)}
            </p>
          )}
          {!tleLoading && tleSource === 'celestrak' && tleMeta && (
            tleMeta.effective_source === 'embedded_fallback' ? (
              <p className="text-[9px] text-amber-400 font-mono mt-1">
                ⚠ {t('header.sourceFallback', lang)} — {t('event.tleFallback', lang)}
              </p>
            ) : tleMeta.effective_source === 'celestrak_partial' ? (
              <p className="text-[9px] text-amber-300 font-mono mt-1">
                ⚠ {tleMeta.live_count}/{tleMeta.total} live, {tleMeta.fallback_count} embedded
              </p>
            ) : (
              <p className="text-[9px] text-green-400 font-mono mt-1">
                ● {tleMeta.live_count}/{tleMeta.total} live
              </p>
            )
          )}
        </div>
      )}

      {/* Orbital planes (virtual orbits only) */}
      {orbitAltitudeKm > 0 && (
        <div className="mb-4">
          <label className="block text-xs text-star-400 font-mono mb-2">
            {t('control.orbitalPlanes', lang)}: <span className="text-star-200">{orbitalPlanes}</span>
          </label>
          <input
            type="range"
            min={1}
            max={7}
            step={1}
            value={orbitalPlanes}
            onChange={(e) => setOrbitalPlanes(Number(e.target.value))}
          />
          <div className="flex justify-between text-[10px] text-star-700 font-mono mt-0.5">
            <span>1</span>
            <span>7</span>
          </div>
          <p className="text-[9px] text-star-600 font-mono mt-1">
            Walker-δ {satelliteCount}/{orbitalPlanes}/{orbitalPlanes > 1 ? Math.max(1, Math.floor(orbitalPlanes / 2)) : 0}: {Math.ceil(satelliteCount / orbitalPlanes)} {t('control.scPerPlane', lang)}
          </p>
        </div>
      )}

      {/* Communication range */}
      <div className="mb-4">
        <label className="block text-xs text-star-400 font-mono mb-2">
          {t('control.commRange', lang)}: <span className="text-star-200">{commRangeKm} {lang === 'ru' ? 'км' : 'km'}</span>
        </label>
        <input
          type="range"
          min={50}
          max={2000}
          step={50}
          value={commRangeKm}
          onChange={(e) => setCommRangeKm(Number(e.target.value))}
        />
        <div className="flex justify-between text-[10px] text-star-700 font-mono mt-0.5">
          <span>50</span>
          <span>1000</span>
          <span>2000 {lang === 'ru' ? 'км' : 'km'}</span>
        </div>
      </div>

      {/* Toggles */}
      <div className="mb-4 space-y-2">
        <Toggle label={t('control.orbitalTracks', lang)} checked={showOrbits} onChange={setShowOrbits} />
        <Toggle label={t('control.satLabels', lang)} checked={showLabels} onChange={setShowLabels} />
        <Toggle
          label={
            <span>
              {t('control.islLinks', lang)}
              <span className="ml-1 text-[10px] text-green-400 font-mono">●</span>
            </span>
          }
          checked={showLinks}
          onChange={setShowLinks}
        />
        <Toggle label={t('control.coverageZones', lang)} checked={showCoverage} onChange={setShowCoverage} />
      </div>

      {/* Constellations */}
      <div className="mb-4">
        <label className="block text-xs text-star-400 font-mono mb-2">
          {t('control.constellations', lang)}
        </label>
        <div className="space-y-1">
          {Object.entries(CONSTELLATION_COLORS).map(([name, color]) => (
            <button
              key={name}
              onClick={() => toggleConstellation(name)}
              className={`flex items-center gap-2 w-full text-left text-xs px-2 py-1.5 rounded-md transition-all ${
                activeConstellations.includes(name)
                  ? 'opacity-100'
                  : 'opacity-30'
              }`}
              style={{
                background: activeConstellations.includes(name)
                  ? `${color}15`
                  : 'transparent',
                borderLeft: `3px solid ${color}`,
              }}
            >
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: color }}
              />
              <span className="font-body text-star-200">{tConstellation(name, lang)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Reset */}
      <button onClick={resetView} className="btn-star w-full text-xs py-2">
        {t('control.reset', lang)}
      </button>
    </div>
  );
}

// ── Toggle ──────────────────────────────────────────────────────────
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: React.ReactNode;
  checked: boolean;
  onChange: (val: boolean) => void;
}) {
  return (
    <div
      className="flex items-center gap-2 cursor-pointer group"
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
    >
      <div
        className={`w-8 h-4 rounded-full transition-all relative flex-shrink-0 ${
          checked
            ? 'bg-star-600'
            : 'bg-void-700 border border-star-900'
        }`}
      >
        <div
          className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${
            checked
              ? 'left-4 bg-star-200 shadow-[0_0_6px_rgba(51,137,255,0.6)]'
              : 'left-0.5 bg-star-800'
          }`}
        />
      </div>
      <span className="text-xs text-star-300 font-body group-hover:text-star-100 transition-colors select-none">
        {label}
      </span>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useStore } from '../hooks/useStore';
import { t } from '../i18n';
import { fetchCollisions, ApiError } from '../services/api';
import type { CollisionApproach } from '../types';

function riskColor(level: string): string {
  switch (level) {
    case 'critical': return 'text-red-400';
    case 'warning': return 'text-amber-300';
    default: return 'text-star-300';
  }
}

export function CollisionPanel() {
  const [open, setOpen] = useState(false);
  const [threshold, setThreshold] = useState(100);
  const [hours, setHours] = useState(24);
  const [loading, setLoading] = useState(false);
  const [approaches, setApproaches] = useState<CollisionApproach[] | null>(null);
  const { lang, tleSource, orbitAltitudeKm, satelliteCount, orbitalPlanes, inclinationDeg, pushToast, logEvent, focusSatellite } = useStore();
  const requestSeqRef = useRef(0);

  const mode: 'real' | 'virtual' = orbitAltitudeKm > 0 ? 'virtual' : 'real';

  useEffect(() => {
    requestSeqRef.current += 1;
    setApproaches(null);
    setLoading(false);
  }, [mode, tleSource, satelliteCount, orbitAltitudeKm, orbitalPlanes, inclinationDeg, threshold, hours]);

  const run = async () => {
    const requestId = requestSeqRef.current + 1;
    requestSeqRef.current = requestId;
    setLoading(true);
    try {
      const res = await fetchCollisions(threshold, hours, {
        source: tleSource,
        mode,
        satellite_count: satelliteCount,
        altitude_km: orbitAltitudeKm,
        planes: orbitalPlanes,
        inclination_deg: inclinationDeg,
      });
      if (requestId !== requestSeqRef.current) return;
      setApproaches(res.close_approaches);
      logEvent({
        level: res.count > 0 ? 'warning' : 'info',
        kind: 'collision_forecast',
        message: `${t('event.collisionForecast', lang)}: ${res.count}`,
        details: `${mode} · ${threshold} ${t('unit.km', lang)} / ${hours} h`,
      });
    } catch (err) {
      if (requestId !== requestSeqRef.current) return;
      const detail = err instanceof ApiError ? err.detail : String(err);
      pushToast({ level: 'error', title: t('event.apiError', lang), detail });
      logEvent({ level: 'error', kind: 'api_error', message: 'fetchCollisions failed', details: detail });
    } finally {
      if (requestId !== requestSeqRef.current) return;
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="glass-panel px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-star-300 hover:text-star-100 flex items-center gap-2 pointer-events-auto"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
        {t('collision.title', lang)}
      </button>
    );
  }

  return (
    <div className="glass-panel w-[320px] p-3 pointer-events-auto animate-slide-right">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
          <span className="text-[11px] font-mono uppercase tracking-wider text-star-200">
            {t('collision.title', lang)}
          </span>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="text-star-500 hover:text-star-200 text-base leading-none"
        >
          ×
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-2">
        <label className="block">
          <span className="text-[9px] text-star-500 font-mono uppercase">{t('collision.threshold', lang)}</span>
          <input
            type="number"
            min={1}
            max={1000}
            value={threshold}
            onChange={(e) => setThreshold(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))}
            className="w-full bg-void-900/60 border border-star-800 rounded px-2 py-1 text-[11px] font-mono text-star-200"
          />
        </label>
        <label className="block">
          <span className="text-[9px] text-star-500 font-mono uppercase">{t('collision.horizon', lang)}</span>
          <input
            type="number"
            min={1}
            max={168}
            value={hours}
            onChange={(e) => setHours(Math.max(1, Math.min(168, Number(e.target.value) || 1)))}
            className="w-full bg-void-900/60 border border-star-800 rounded px-2 py-1 text-[11px] font-mono text-star-200"
          />
        </label>
      </div>
      <div className="text-[9px] text-star-500 font-mono mb-2 uppercase tracking-wide">
        {t('collision.mode', lang)}: {mode === 'virtual' ? t('mode.virtual', lang) : t('mode.realTle', lang)}
      </div>
      <button
        onClick={run}
        disabled={loading}
        className="btn-star w-full text-[11px] py-1.5 disabled:opacity-50"
      >
        {loading ? t('collision.running', lang) : t('collision.run', lang)}
      </button>

      {approaches && (
        <div className="mt-2 max-h-[240px] overflow-y-auto space-y-1">
          {approaches.length === 0 && (
            <div className="text-[10px] text-star-500 font-body text-center py-3">
              {t('collision.none', lang)}
            </div>
          )}
          {approaches.map((a) => (
            <button
              key={`${a.norad_id_1}-${a.norad_id_2}-${a.time_of_closest_approach}`}
              onClick={() => focusSatellite(a.norad_id_1)}
              className="w-full text-left px-2 py-1.5 rounded border border-star-900/60 hover:border-star-700 bg-void-900/40 transition-colors"
            >
              <div className="flex justify-between items-baseline">
                <span className={`text-[10px] font-mono uppercase ${riskColor(a.risk_level)}`}>
                  {a.risk_level}
                </span>
                <span className="text-[10px] font-mono text-star-300">
                  {a.min_distance_km.toFixed(1)} {t('unit.km', lang)}
                </span>
              </div>
              <div className="text-[10px] text-star-300 font-body truncate">
                {a.name_1} ↔ {a.name_2}
              </div>
              <div className="text-[9px] text-star-600 font-mono truncate">
                {a.time_of_closest_approach.substring(0, 19).replace('T', ' ')}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

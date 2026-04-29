import { useState } from 'react';
import { useStore } from '../hooks/useStore';
import { t } from '../i18n';
import { fetchOptimizePlanes, ApiError } from '../services/api';
import type { APIOptimizerResponse } from '../types';

export function OptimizerPanel() {
  const [open, setOpen] = useState(false);
  const {
    lang,
    satelliteCount, orbitalPlanes, orbitAltitudeKm, orbitInclinationDeg,
    setSatelliteCount, setOrbitalPlanes, setOrbitAltitudeKm, setOrbitInclinationDeg,
    pushToast, logEvent,
  } = useStore();

  const [num, setNum] = useState(Math.max(3, Math.min(15, satelliteCount)));
  const [planes, setPlanes] = useState(Math.max(1, Math.min(7, orbitalPlanes)));
  const [alt, setAlt] = useState(orbitAltitudeKm > 0 ? orbitAltitudeKm : 550);
  const [incl, setIncl] = useState(orbitInclinationDeg);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<APIOptimizerResponse | null>(null);

  const km = lang === 'ru' ? 'км' : 'km';

  const run = async () => {
    setLoading(true);
    try {
      const res = await fetchOptimizePlanes({
        num_satellites: num, num_planes: planes,
        altitude_km: alt, inclination_deg: incl,
      });
      setResult(res);
    } catch (err) {
      const detail = err instanceof ApiError ? err.detail : String(err);
      pushToast({ level: 'error', title: t('event.apiError', lang), detail });
      logEvent({ level: 'error', kind: 'api_error', message: 'fetchOptimizePlanes failed', details: detail });
    } finally {
      setLoading(false);
    }
  };

  const apply = () => {
    if (!result) return;
    setSatelliteCount(result.total_satellites);
    setOrbitalPlanes(result.num_planes);
    setOrbitAltitudeKm(result.altitude_km);
    // Inclination must round-trip too — without this the virtual scene
    // ignores the slider and silently uses the legacy 55° default.
    setOrbitInclinationDeg(result.inclination_deg);
    logEvent({
      level: 'success',
      kind: 'optimizer_apply',
      message: t('event.optimizerApply', lang),
      details: result.walker_notation,
    });
    pushToast({
      level: 'success',
      title: t('event.optimizerApply', lang),
      detail: result.walker_notation,
    });
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="glass-panel px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-star-300 hover:text-star-100 flex items-center gap-2 pointer-events-auto"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
        {t('optimizer.title', lang)}
      </button>
    );
  }

  return (
    <div className="glass-panel w-[320px] p-3 pointer-events-auto animate-slide-right">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          <span className="text-[11px] font-mono uppercase tracking-wider text-star-200">
            {t('optimizer.title', lang)}
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
        <NumField label={t('optimizer.sats', lang)} min={3} max={15} value={num} onChange={setNum} />
        <NumField label={t('optimizer.planes', lang)} min={1} max={7} value={planes} onChange={setPlanes} />
        <NumField label={t('optimizer.altitude', lang)} min={400} max={2000} step={50} value={alt} onChange={setAlt} />
        <NumField label={t('optimizer.inclination', lang)} min={0} max={180} step={1} value={incl} onChange={setIncl} />
      </div>

      <button
        onClick={run}
        disabled={loading}
        className="btn-star w-full text-[11px] py-1.5 disabled:opacity-50"
      >
        {loading ? t('collision.running', lang) : t('optimizer.run', lang)}
      </button>

      {result && (
        <div className="mt-2 space-y-1 pt-2 border-t border-star-900/60">
          <div className="flex justify-between text-[10px] font-mono">
            <span className="text-star-500 uppercase">Walker</span>
            <span className="text-green-400">{result.walker_notation}</span>
          </div>
          <div className="flex justify-between text-[10px] font-mono">
            <span className="text-star-500 uppercase">{t('optimizer.period', lang)}</span>
            <span className="text-star-200">{result.orbital_period_min.toFixed(1)} min</span>
          </div>
          <div className="flex justify-between text-[10px] font-mono">
            <span className="text-star-500 uppercase">{t('optimizer.velocity', lang)}</span>
            <span className="text-star-200">{result.velocity_km_s.toFixed(2)} km/s</span>
          </div>
          <div className="flex justify-between text-[10px] font-mono">
            <span className="text-star-500 uppercase">{t('optimizer.altitude', lang)}</span>
            <span className="text-star-200">{result.altitude_km} {km}</span>
          </div>
          <div className="flex justify-between text-[10px] font-mono">
            <span className="text-star-500 uppercase">{t('optimizer.inclination', lang)}</span>
            <span className="text-star-200">{result.inclination_deg.toFixed(0)}°</span>
          </div>
          {result.objective && (
            <div className="mt-1 pt-1 border-t border-star-900/40 space-y-0.5">
              <div className="flex justify-between text-[10px] font-mono">
                <span className="text-star-500 uppercase">{t('optimizer.score', lang)}</span>
                <span className="text-green-400">
                  {(result.objective.score * 100).toFixed(0)}%
                </span>
              </div>
              <div className="flex justify-between text-[9px] font-mono opacity-80">
                <span className="text-star-600 uppercase">{t('optimizer.coverage', lang)}</span>
                <span className="text-star-300">
                  {(result.objective.coverage_fraction * 100).toFixed(0)}%
                </span>
              </div>
              <div className="flex justify-between text-[9px] font-mono opacity-80">
                <span className="text-star-600 uppercase">{t('optimizer.uniformity', lang)}</span>
                <span className="text-star-300">
                  {(result.objective.phase_uniformity * 100).toFixed(0)}%
                </span>
              </div>
              <div className="flex justify-between text-[9px] font-mono opacity-60">
                <span className="text-star-700 uppercase">{t('optimizer.candidates', lang)}</span>
                <span className="text-star-500">{result.objective.candidates_evaluated}</span>
              </div>
            </div>
          )}
          <button
            onClick={apply}
            className="btn-star w-full text-[10px] py-1.5 mt-1"
          >
            {t('optimizer.apply', lang)}
          </button>
          <p className="text-[9px] text-star-600 font-body leading-snug">
            {result.coverage_note}
          </p>
        </div>
      )}
    </div>
  );
}

function NumField({
  label, min, max, step = 1, value, onChange,
}: {
  label: string; min: number; max: number; step?: number; value: number; onChange: (n: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-[9px] text-star-500 font-mono uppercase">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
        className="w-full bg-void-900/60 border border-star-800 rounded px-2 py-1 text-[11px] font-mono text-star-200"
      />
    </label>
  );
}

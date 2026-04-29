import { useState, useEffect, useRef } from 'react';
import { useStore } from '../hooks/useStore';
import { t } from '../i18n';
import { fetchOptimizePlanes, ApiError } from '../services/api';
import type { APIOptimizerResponse } from '../types';

export function OptimizerPanel() {
  const [open, setOpen] = useState(false);
  const {
    lang,
    satelliteCount, orbitalPlanes, orbitAltitudeKm, inclinationDeg,
    setSatelliteCount, setOrbitalPlanes, setOrbitAltitudeKm, setInclinationDeg,
    pushToast, logEvent,
  } = useStore();

  const [num, setNum] = useState(Math.max(3, Math.min(15, satelliteCount)));
  const [planes, setPlanes] = useState(Math.max(1, Math.min(7, orbitalPlanes)));
  const [alt, setAlt] = useState(orbitAltitudeKm > 0 ? orbitAltitudeKm : 550);
  const [incl, setIncl] = useState(inclinationDeg);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<APIOptimizerResponse | null>(null);
  const requestSeqRef = useRef(0);

  const km = lang === 'ru' ? 'км' : 'km';

  useEffect(() => {
    setNum(Math.max(3, Math.min(15, satelliteCount)));
    setPlanes(Math.max(1, Math.min(7, orbitalPlanes)));
    setAlt(orbitAltitudeKm > 0 ? orbitAltitudeKm : 550);
    setIncl(inclinationDeg);
  }, [satelliteCount, orbitalPlanes, orbitAltitudeKm, inclinationDeg, open]);

  useEffect(() => {
    requestSeqRef.current += 1;
    setResult(null);
    setLoading(false);
  }, [num, planes, alt, incl]);

  const run = async () => {
    const requestId = requestSeqRef.current + 1;
    requestSeqRef.current = requestId;
    setLoading(true);
    try {
      const res = await fetchOptimizePlanes({
        num_satellites: num, num_planes: planes,
        altitude_km: alt, inclination_deg: incl,
      });
      if (requestId !== requestSeqRef.current) return;
      setResult(res);
    } catch (err) {
      if (requestId !== requestSeqRef.current) return;
      const detail = err instanceof ApiError ? err.detail : String(err);
      pushToast({ level: 'error', title: t('event.apiError', lang), detail });
      logEvent({ level: 'error', kind: 'api_error', message: 'fetchOptimizePlanes failed', details: detail });
    } finally {
      if (requestId === requestSeqRef.current) {
        setLoading(false);
      }
    }
  };

  const apply = () => {
    if (!result) return;
    setSatelliteCount(result.total_satellites);
    setOrbitalPlanes(result.num_planes);
    setOrbitAltitudeKm(result.altitude_km);
    setInclinationDeg(result.inclination_deg);
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
            <span className="text-star-200">{result.orbital_period_min.toFixed(1)} {t('unit.min', lang)}</span>
          </div>
          <div className="flex justify-between text-[10px] font-mono">
            <span className="text-star-500 uppercase">{t('optimizer.velocity', lang)}</span>
            <span className="text-star-200">{result.velocity_km_s.toFixed(2)} {t('unit.kmps', lang)}</span>
          </div>
          <div className="flex justify-between text-[10px] font-mono">
            <span className="text-star-500 uppercase">{t('optimizer.inclination', lang)}</span>
            <span className="text-star-200">{result.inclination_deg.toFixed(1)}°</span>
          </div>
          <div className="flex justify-between text-[10px] font-mono">
            <span className="text-star-500 uppercase">{t('optimizer.altitude', lang)}</span>
            <span className="text-star-200">{result.altitude_km} {km}</span>
          </div>
          <button
            onClick={apply}
            className="btn-star w-full text-[10px] py-1.5 mt-1"
          >
            {t('optimizer.apply', lang)}
          </button>
          <p className="text-[9px] text-star-600 font-body leading-snug">
            {t('optimizer.coverageNote', lang, {
              walker: result.walker_notation,
              planes: result.num_planes,
              spacing: result.num_planes > 0 ? (360 / result.num_planes).toFixed(1) : '0.0',
              satsPerPlane: result.sats_per_plane,
              phase: result.phase_factor,
            })}
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

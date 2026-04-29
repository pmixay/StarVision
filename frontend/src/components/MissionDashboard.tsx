import { useState, useMemo } from 'react';
import { useStore } from '../hooks/useStore';
import { t } from '../i18n';
import type { EffectiveTleSource } from '../types';

function sourceLine(s: EffectiveTleSource | undefined, lang: 'ru' | 'en'): string {
  switch (s) {
    case 'celestrak': return t('source.liveLong', lang);
    case 'celestrak_partial': return t('source.partialLong', lang);
    case 'embedded_fallback': return t('source.demoFallbackLong', lang);
    case 'embedded': return t('source.demoLong', lang);
    default: return '—';
  }
}

interface MissionDashboardProps {
  displayedCount: number;
  activeCount: number;
}

export function MissionDashboard({ displayedCount, activeCount }: MissionDashboardProps) {
  const [open, setOpen] = useState(false);
  const {
    lang,
    tleMeta,
    backendHealth,
    activeLinksCount,
    commRangeKm,
    orbitAltitudeKm,
    satelliteCount,
    orbitalPlanes,
    inclinationDeg,
  } = useStore();

  const mode = orbitAltitudeKm > 0
    ? `${t('mode.virtual', lang)} · ${orbitAltitudeKm} ${lang === 'ru' ? 'км' : 'km'} / ${orbitalPlanes}P / ${inclinationDeg.toFixed(0)}°`
    : t('mode.realTle', lang);

  const archival = backendHealth?.catalog?.archival ?? 0;
  const operational = backendHealth?.catalog?.operational ?? 0;

  const km = lang === 'ru' ? 'км' : 'km';

  const metrics = useMemo(() => ([
    { label: t('dashboard.mode', lang), value: mode },
    { label: t('dashboard.source', lang), value: sourceLine(tleMeta?.effective_source, lang) },
    { label: t('dashboard.operational', lang), value: `${operational}` },
    { label: t('dashboard.archival', lang), value: `${archival}` },
    { label: t('dashboard.visible', lang), value: `${activeCount}/${displayedCount}/${satelliteCount}` },
    { label: t('dashboard.activeIsl', lang), value: `${activeLinksCount}` },
    { label: t('dashboard.commRange', lang), value: `${commRangeKm} ${km}` },
  ]), [lang, mode, tleMeta, operational, archival, activeCount, displayedCount, satelliteCount, activeLinksCount, commRangeKm, km]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="glass-panel px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-star-300 hover:text-star-100 flex items-center gap-2 pointer-events-auto"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
        {t('dashboard.title', lang)}
      </button>
    );
  }

  return (
    <div className="glass-panel w-[280px] p-3 pointer-events-auto animate-slide-right">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          <span className="text-[11px] font-mono uppercase tracking-wider text-star-200">
            {t('dashboard.title', lang)}
          </span>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="text-star-500 hover:text-star-200 text-base leading-none"
        >
          ×
        </button>
      </div>
      <div className="space-y-1">
        {metrics.map(({ label, value }) => (
          <div key={label} className="flex justify-between items-baseline gap-2">
            <span className="text-[10px] text-star-500 font-mono uppercase">{label}</span>
            <span className="text-[11px] text-star-200 font-mono text-right break-words min-w-0">
              {value}
            </span>
          </div>
        ))}
      </div>
      {tleMeta && (tleMeta.effective_source === 'embedded_fallback' || tleMeta.effective_source === 'celestrak_partial') && (
        <div className="mt-2 pt-2 border-t border-amber-500/20 text-[9px] text-amber-300 font-mono">
          ⚠ {tleMeta.fallback_count}/{tleMeta.total} {t('source.fallbackShort', lang)}
        </div>
      )}
    </div>
  );
}

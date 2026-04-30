import { useState, useEffect } from 'react';
import { useStore } from '../hooks/useStore';
import { t } from '../i18n';
import type { Lang } from '../i18n';
import type { EffectiveTleSource } from '../types';

interface HeaderProps {
  satelliteCount: number;
  activeCount: number;
  timeSpeed: number;
  activeLinksCount: number;
}

function sourceLabel(effective: EffectiveTleSource | undefined, lang: Lang): string {
  switch (effective) {
    case 'celestrak': return t('source.liveShort', lang);
    case 'celestrak_partial': return t('source.partialShort', lang);
    case 'embedded_fallback': return t('source.demoFallbackShort', lang);
    case 'embedded':
    default:
      return t('source.demoShort', lang);
  }
}

function sourceClass(effective: EffectiveTleSource | undefined): string {
  switch (effective) {
    case 'celestrak': return 'text-green-400';
    case 'celestrak_partial': return 'text-amber-300';
    case 'embedded_fallback': return 'text-amber-400';
    case 'embedded':
    default:
      return 'text-star-300';
  }
}

function formatFreshness(fetchedAtIso: string | undefined, now: number, lang: Lang): string {
  if (!fetchedAtIso) return '—';
  const fetchedAt = Date.parse(fetchedAtIso);
  if (Number.isNaN(fetchedAt)) return '—';
  const ageMs = Math.max(0, now - fetchedAt);
  const ageMin = Math.floor(ageMs / 60000);
  if (ageMin < 1) return t('header.freshJustNow', lang);
  if (ageMin < 60) return `${ageMin} ${t('header.freshMinutes', lang)}`;
  const ageH = Math.floor(ageMin / 60);
  return `${ageH} ${t('header.freshHours', lang)}`;
}

export function Header({ satelliteCount, activeCount, timeSpeed, activeLinksCount }: HeaderProps) {
  const { lang, setLang, tleMeta, backendReachable } = useStore();
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const utcStr = time.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
  const effective = tleMeta?.effective_source;
  const srcText = sourceLabel(effective, lang);
  const srcClass = sourceClass(effective);
  const freshness = formatFreshness(tleMeta?.fetched_at, time.getTime(), lang);

  let statusText = t('header.online', lang);
  let statusClass = 'text-green-400';
  if (!backendReachable) {
    statusText = t('header.offline', lang);
    statusClass = 'text-red-400';
  } else if (effective === 'embedded_fallback' || effective === 'celestrak_partial') {
    statusText = t('header.degraded', lang);
    statusClass = 'text-amber-400';
  }

  return (
    <div className="absolute top-0 left-0 right-0 z-10 pointer-events-none">
      <div className="flex items-start sm:items-center justify-between px-2 sm:px-4 py-2 sm:py-3 gap-2 flex-wrap">
        {/* Logo — pushed right on desktop so it doesn't collide with the
            ControlPanel; on mobile the panel is collapsed by default so
            the offset is unnecessary and would steal status-bar space. */}
        <div className="pointer-events-auto flex items-center gap-2 sm:gap-3 ml-12 sm:ml-[310px]">
          <div className="relative">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-gradient-to-br from-star-500/20 via-star-600/15 to-star-900/30 flex items-center justify-center shadow-lg shadow-star-600/30 ring-1 ring-star-500/30">
              <img src="/brand/logo.svg" alt="StarVision" className="w-6 h-6 sm:w-7 sm:h-7 drop-shadow-[0_0_6px_rgba(80,150,255,0.55)]" />
            </div>
            <div className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ${
              backendReachable ? 'bg-green-400' : 'bg-red-400'
            } border border-void-900`} />
          </div>
          <div className="hidden sm:block">
            <h1 className="font-display font-bold text-star-100 text-sm tracking-wide">
              StarVision
            </h1>
            <p className="text-[9px] text-star-500 font-mono tracking-wider">
              {t('header.subtitle', lang)}
            </p>
          </div>
        </div>

        <div className="hidden sm:block flex-1" />

        {/* Language switcher + Status bar. On mobile the bar shrinks to
            the high-signal items only (count, speed, status) so the 3D
            view keeps most of the viewport. */}
        <div className="pointer-events-auto flex items-center gap-2 sm:gap-3 sm:mr-4 flex-wrap justify-end ml-auto">
          <div className="flex items-center gap-0.5 glass-panel px-1.5 py-1">
            <LangButton current={lang} value="ru" label="RU" onClick={setLang} />
            <LangButton current={lang} value="en" label="EN" onClick={setLang} />
          </div>

          <div className="flex items-center gap-2 sm:gap-4 glass-panel px-2 sm:px-4 py-1.5 sm:py-2 flex-wrap">
            <StatusItem className="hidden md:flex" label={t('header.utc', lang)} value={utcStr} />
            <Divider className="hidden md:block" />
            <StatusItem label={t('header.spacecraft', lang)} value={`${activeCount}/${satelliteCount}`} />
            <Divider />
            <StatusItem label={t('header.speed', lang)} value={`${timeSpeed}×`} />
            <Divider className="hidden sm:block" />
            <StatusItem
              className="hidden sm:flex"
              label={t('header.isl', lang)}
              value={`${activeLinksCount}`}
              valueClass={activeLinksCount > 0 ? 'text-green-400' : 'text-star-600'}
            />
            <Divider className="hidden md:block" />
            <StatusItem
              className="hidden md:flex"
              label={t('header.source', lang)}
              value={srcText}
              valueClass={srcClass}
              title={tleMeta ? `${t('header.source', lang)}: ${srcText}; requested=${tleMeta.requested_source}; live=${tleMeta.live_count}/${tleMeta.total}; fallback=${tleMeta.fallback_count}` : undefined}
            />
            <Divider className="hidden md:block" />
            <StatusItem className="hidden md:flex" label={t('header.fresh', lang)} value={freshness} />
            <Divider />
            <StatusItem
              label={t('header.status', lang)}
              value={statusText}
              valueClass={statusClass}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function LangButton({
  current,
  value,
  label,
  onClick,
}: {
  current: Lang;
  value: Lang;
  label: string;
  onClick: (lang: Lang) => void;
}) {
  const isActive = current === value;
  return (
    <button
      onClick={() => onClick(value)}
      className={`text-[10px] font-mono px-2 py-0.5 rounded-md transition-all ${
        isActive
          ? 'bg-star-600/40 text-star-100 border border-star-500/40'
          : 'text-star-500 hover:text-star-300 border border-transparent'
      }`}
    >
      {label}
    </button>
  );
}

function StatusItem({
  label,
  value,
  valueClass = 'text-star-200',
  title,
  className = '',
}: {
  label: string;
  value: string;
  valueClass?: string;
  title?: string;
  className?: string;
}) {
  return (
    <div className={`flex items-baseline gap-1.5 ${className}`} title={title}>
      <span className="text-[9px] text-star-600 font-mono uppercase">{label}</span>
      <span className={`text-[11px] font-mono ${valueClass}`}>{value}</span>
    </div>
  );
}

function Divider({ className = '' }: { className?: string }) {
  return <div className={`w-px h-3 bg-star-800 ${className}`} />;
}

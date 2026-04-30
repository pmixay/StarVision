import { useState } from 'react';
import { useStore } from '../hooks/useStore';
import { t } from '../i18n';
import type { EventLevel } from '../types';

const LEVEL_DOT: Record<EventLevel, string> = {
  info: 'bg-blue-400',
  success: 'bg-green-400',
  warning: 'bg-amber-400',
  error: 'bg-red-400',
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toISOString().substring(11, 19); // HH:MM:SS UTC
}

export function EventLog() {
  const { lang, events, clearEvents } = useStore();
  const [open, setOpen] = useState(false);

  if (!open) {
    const badge = events.length;
    return (
      <button
        onClick={() => setOpen(true)}
        className="glass-panel px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-star-300 hover:text-star-100 flex items-center gap-2 pointer-events-auto"
        title={t('events.title', lang)}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-star-500 animate-pulse" />
        {t('events.title', lang)}
        {badge > 0 && (
          <span className="text-[9px] bg-star-700/60 border border-star-600/40 rounded-full px-1.5">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="glass-panel w-[min(320px,calc(100vw-1rem))] max-h-[60vh] flex flex-col pointer-events-auto animate-slide-right">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-star-400 animate-pulse" />
          <span className="text-[11px] font-mono uppercase tracking-wider text-star-200">
            {t('events.title', lang)}
          </span>
          <span className="text-[10px] text-star-600 font-mono">({events.length})</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={clearEvents}
            className="text-[10px] text-star-500 hover:text-star-200 font-mono"
            disabled={events.length === 0}
          >
            {t('events.clear', lang)}
          </button>
          <button
            onClick={() => setOpen(false)}
            className="text-star-500 hover:text-star-200 text-base leading-none"
            aria-label="close"
          >
            ×
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
        {events.length === 0 && (
          <div className="text-[10px] text-star-600 font-body text-center py-6">
            {t('events.empty', lang)}
          </div>
        )}
        {events.map((ev) => (
          <div key={ev.id} className="flex items-start gap-2 text-[10px] font-mono">
            <span className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${LEVEL_DOT[ev.level]}`} />
            <span className="text-star-700 flex-shrink-0">{formatTime(ev.timestamp)}</span>
            <div className="min-w-0">
              <div className="text-star-200 break-words leading-snug">{ev.message}</div>
              {ev.details && (
                <div className="text-star-500 text-[9px] break-words leading-snug">{ev.details}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

import { useEffect } from 'react';
import { useStore } from '../hooks/useStore';
import type { AppToast, EventLevel } from '../types';

const LEVEL_STYLES: Record<EventLevel, { border: string; glow: string; dot: string }> = {
  info:    { border: 'border-blue-400/40',   glow: 'shadow-blue-500/20',   dot: 'bg-blue-400' },
  success: { border: 'border-green-400/40',  glow: 'shadow-green-500/20',  dot: 'bg-green-400' },
  warning: { border: 'border-amber-400/50',  glow: 'shadow-amber-500/25',  dot: 'bg-amber-400' },
  error:   { border: 'border-red-500/50',    glow: 'shadow-red-500/25',    dot: 'bg-red-400' },
};

function ToastCard({ toast }: { toast: AppToast }) {
  const dismissToast = useStore((s) => s.dismissToast);
  const ttl = toast.ttlMs ?? (toast.level === 'error' ? 8000 : 4500);
  const style = LEVEL_STYLES[toast.level] ?? LEVEL_STYLES.info;

  useEffect(() => {
    const id = setTimeout(() => dismissToast(toast.id), ttl);
    return () => clearTimeout(id);
  }, [toast.id, ttl, dismissToast]);

  return (
    <div
      className={`glass-panel ${style.border} ${style.glow} shadow-lg rounded-lg px-3 py-2 w-full sm:min-w-[260px] sm:max-w-[380px] animate-slide-right`}
    >
      <div className="flex items-start gap-2">
        <span className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${style.dot}`} />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-mono uppercase tracking-wider text-star-200">
            {toast.title}
          </div>
          {toast.detail && (
            <div className="text-[10px] text-star-400 font-body mt-0.5 break-words leading-snug">
              {toast.detail}
            </div>
          )}
        </div>
        <button
          onClick={() => dismissToast(toast.id)}
          className="text-star-600 hover:text-star-200 transition-colors text-sm leading-none -mr-0.5"
          aria-label="dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
}

export function ErrorToast() {
  const toasts = useStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="absolute top-24 sm:top-20 right-2 sm:right-4 left-2 sm:left-auto z-30 flex flex-col gap-2 pointer-events-auto">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </div>
  );
}

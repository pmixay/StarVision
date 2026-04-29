import { useState, useRef, useEffect } from 'react';
import { useStore } from '../hooks/useStore';
import { sendChatMessage } from '../services/api';
import { t } from '../i18n';
import type { SatelliteData } from '../types';

// Client-side mirror of the backend whitelist. The server now validates
// actions, but the UI must not crash on a malformed payload from an
// older/misconfigured server. Returns the sanitised action, or null
// with a reason for rejection (surfaced to the user).
function sanitizeAction(
  action: Record<string, unknown>,
  satellites: SatelliteData[],
): { action: Record<string, unknown> | null; reason?: string } {
  if (!action || typeof action !== 'object') return { action: null, reason: 'not object' };
  const type = typeof action.type === 'string' ? action.type : null;
  if (!type) return { action: null, reason: 'missing type' };

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

  switch (type) {
    case 'focus_satellite': {
      const nid = num(action.norad_id);
      if (nid === null) return { action: null, reason: 'norad_id required' };
      const sat = satellites.find((s) => s.norad_id === nid);
      if (!sat) return { action: null, reason: `unknown NORAD ${nid}` };
      if (!sat.operational) return { action: null, reason: `${sat.name} is archival` };
      return { action: { type, norad_id: nid } };
    }
    case 'set_time_speed': {
      const v = num(action.speed);
      if (v === null) return { action: null, reason: 'speed required' };
      return { action: { type, speed: Math.round(clamp(v, 1, 200)) } };
    }
    case 'toggle_orbits':
    case 'toggle_links':
    case 'toggle_coverage':
    case 'toggle_labels': {
      const v = bool(action.visible);
      if (v === null) return { action: null, reason: `${type}.visible must be boolean` };
      return { action: { type, visible: v } };
    }
    case 'highlight_constellation': {
      const name = typeof action.name === 'string' ? action.name : null;
      if (!name) return { action: null, reason: 'name required' };
      return { action: { type, name } };
    }
    case 'set_satellite_count': {
      const v = num(action.count);
      if (v === null) return { action: null, reason: 'count required' };
      return { action: { type, count: Math.round(clamp(v, 3, 15)) } };
    }
    case 'set_comm_range': {
      const v = num(action.range_km);
      if (v === null) return { action: null, reason: 'range_km required' };
      return { action: { type, range_km: Math.round(clamp(v, 50, 2000)) } };
    }
    case 'set_orbit_altitude': {
      const v = num(action.altitude_km);
      if (v === null) return { action: null, reason: 'altitude_km required' };
      const alt = v <= 0 ? 0 : Math.round(clamp(v, 400, 2000));
      return { action: { type, altitude_km: alt } };
    }
    case 'set_orbital_planes': {
      const v = num(action.planes);
      if (v === null) return { action: null, reason: 'planes required' };
      return { action: { type, planes: Math.round(clamp(v, 1, 7)) } };
    }
    case 'reset_view':
      return { action: { type } };
    default:
      return { action: null, reason: `unknown action ${type}` };
  }
}

// SVG Star icon for StarAI
function StarIcon({ size = 24, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="11" stroke="url(#starGrad)" strokeWidth="0.5" opacity="0.4" className="star-glow-ring" />
      <path
        d="M12 2L14.4 8.8L21.6 9.2L16 13.8L17.8 21L12 17.2L6.2 21L8 13.8L2.4 9.2L9.6 8.8L12 2Z"
        fill="url(#starFill)"
        stroke="rgba(180,220,255,0.5)"
        strokeWidth="0.5"
      />
      <circle cx="12" cy="11" r="2" fill="rgba(255,255,255,0.8)" />
      <defs>
        <linearGradient id="starFill" x1="2" y1="2" x2="22" y2="22">
          <stop offset="0%" stopColor="#6ab4ff" />
          <stop offset="50%" stopColor="#3389ff" />
          <stop offset="100%" stopColor="#1a5cd0" />
        </linearGradient>
        <linearGradient id="starGrad" x1="0" y1="0" x2="24" y2="24">
          <stop offset="0%" stopColor="#88ccff" />
          <stop offset="100%" stopColor="#3389ff" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function StarAIChat() {
  const {
    lang,
    chatOpen, setChatOpen,
    chatMessages, addChatMessage,
    chatLoading, setChatLoading,
    focusSatellite,
    setTimeSpeed,
    setShowOrbits,
    setShowLinks,
    setShowCoverage,
    setShowLabels,
    highlightConstellation,
    setSatelliteCount,
    setCommRangeKm,
    setOrbitAltitudeKm,
    setOrbitalPlanes,
    resetView,
    satellites,
    setUserError,
  } = useStore();

  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const executeActions = (actions: unknown[]) => {
    if (!Array.isArray(actions)) return;
    const rejected: string[] = [];
    // Cap identical to the backend so UI can't be flooded.
    for (const raw of actions.slice(0, 8)) {
      const candidate: Record<string, unknown> =
        raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
      const { action, reason } = sanitizeAction(candidate, satellites);
      if (!action) {
        if (reason) rejected.push(reason);
        continue;
      }
      try {
        switch (action.type) {
          case 'focus_satellite':
            focusSatellite(action.norad_id as number);
            break;
          case 'set_time_speed':
            setTimeSpeed(action.speed as number);
            break;
          case 'toggle_orbits':
            setShowOrbits(action.visible as boolean);
            break;
          case 'toggle_links':
            setShowLinks(action.visible as boolean);
            break;
          case 'highlight_constellation':
            highlightConstellation(action.name as string);
            break;
          case 'set_satellite_count':
            setSatelliteCount(action.count as number);
            break;
          case 'set_comm_range':
            setCommRangeKm(action.range_km as number);
            break;
          case 'set_orbit_altitude':
            setOrbitAltitudeKm(action.altitude_km as number);
            break;
          case 'toggle_coverage':
            setShowCoverage(action.visible as boolean);
            break;
          case 'toggle_labels':
            setShowLabels(action.visible as boolean);
            break;
          case 'set_orbital_planes':
            setOrbitalPlanes(action.planes as number);
            break;
          case 'reset_view':
            resetView();
            break;
        }
      } catch (err) {
        rejected.push(`${action.type}: ${(err as Error)?.message ?? 'runtime error'}`);
      }
    }
    if (rejected.length > 0) {
      setUserError(t('chat.invalidAction', lang, { reason: rejected.join('; ') }));
    }
  };

  const handleSend = async () => {
    const msg = input.trim();
    if (!msg || chatLoading) return;

    setInput('');
    const userMsg = { role: 'user' as const, content: msg, timestamp: Date.now() };
    addChatMessage(userMsg);
    setChatLoading(true);

    // Send previous messages as history (without the new user message).
    // The backend appends user_message to the history itself, so we must
    // NOT include it here to avoid duplicating the message.
    const historyForApi = [...chatMessages];

    try {
      const response = await sendChatMessage(msg, historyForApi, lang);
      addChatMessage({
        role: 'assistant',
        content: response.message,
        actions: response.actions,
        timestamp: Date.now(),
      });

      if (response.actions?.length > 0) {
        executeActions(response.actions);
      }
      // Surface anything the server rejected so the user sees StarAI
      // tried to do something invalid (e.g. focus an archival sat).
      if (Array.isArray(response.rejected_actions) && response.rejected_actions.length > 0) {
        setUserError(
          t('chat.invalidAction', lang, {
            reason: response.rejected_actions.join('; '),
          }),
        );
      }
    } catch {
      addChatMessage({
        role: 'assistant',
        content: t('chat.error', lang),
        timestamp: Date.now(),
      });
    } finally {
      setChatLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const hints = [
    t('chat.hint1', lang),
    t('chat.hint2', lang),
    t('chat.hint3', lang),
    t('chat.hint4', lang),
    t('chat.hint5', lang),
    t('chat.hint6', lang),
  ];

  if (!chatOpen) {
    return (
      <button
        onClick={() => setChatOpen(true)}
        aria-label={t('chat.open', lang)}
        className="absolute bottom-6 right-6 z-20 group cursor-pointer animate-fade-in"
      >
        <div className="relative">
          <div className="absolute inset-0 rounded-full bg-blue-500/20 blur-xl scale-150 group-hover:bg-blue-400/30 transition-all" />
          <div className="relative glass-panel rounded-full w-14 h-14 flex items-center justify-center group-hover:border-blue-400/50 transition-all">
            <StarIcon size={28} className="star-icon" />
          </div>
          <div className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-400 border-2 border-void-900 shadow-lg shadow-green-400/50" />
        </div>
      </button>
    );
  }

  return (
    <div
      className="absolute bottom-4 right-4 z-20 glass-panel w-96 max-w-[92vw] animate-fade-in flex flex-col"
      style={{ height: '500px' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-400/20 to-blue-600/20 flex items-center justify-center border border-blue-400/20">
              <StarIcon size={20} className="star-icon" />
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-400 border border-void-900" />
          </div>
          <div>
            <div className="text-sm font-display font-semibold text-star-100 tracking-wide">StarAI</div>
            <div className="text-[10px] text-blue-300/60 font-mono">
              {chatLoading ? `✦ ${t('chat.analyzing', lang)}` : `✦ ${t('chat.ready', lang)}`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setChatOpen(false)}
            aria-label={t('chat.close', lang)}
            className="text-star-500 hover:text-star-200 transition-colors w-7 h-7 rounded-full hover:bg-white/5 flex items-center justify-center"
          >
            ×
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {chatMessages.length === 0 && (
          <div className="text-center py-6">
            <div className="mb-4">
              <StarIcon size={36} className="mx-auto star-icon opacity-60" />
            </div>
            <div className="text-star-400 text-xs font-body mb-4">
              {t('chat.intro', lang)}<br />
              {t('chat.introSub', lang)}
            </div>
            <div className="space-y-1.5">
              {hints.map((hint) => (
                <button
                  key={hint}
                  onClick={() => setInput(hint)}
                  className="block w-full text-left text-[11px] text-star-400 hover:text-star-200 px-3 py-1.5 rounded-lg hover:bg-blue-500/8 transition-all font-body border border-transparent hover:border-blue-500/15"
                >
                  ✦ {hint}
                </button>
              ))}
            </div>
          </div>
        )}

        {chatMessages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} gap-2`}
          >
            {msg.role === 'assistant' && (
              <div className="flex-shrink-0 w-6 h-6 mt-1">
                <StarIcon size={18} />
              </div>
            )}
            <div
              className={`max-w-[80%] px-3 py-2 rounded-xl text-xs font-body leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-blue-500/20 text-star-100 rounded-br-sm border border-blue-400/15'
                  : 'bg-white/5 text-star-200 rounded-bl-sm border border-white/8'
              }`}
            >
              {msg.content}
              {msg.actions && msg.actions.length > 0 && (
                <div className="mt-1.5 pt-1.5 border-t border-white/8">
                  <span className="text-[9px] text-blue-300/60 font-mono">
                    ✦ {msg.actions.length} {msg.actions.length === 1 ? t('chat.actionDone_one', lang) : t('chat.actionDone_many', lang)}
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}

        {chatLoading && (
          <div className="flex justify-start gap-2">
            <div className="flex-shrink-0 w-6 h-6 mt-1">
              <StarIcon size={18} className="star-icon" />
            </div>
            <div className="bg-white/5 px-4 py-3 rounded-xl rounded-bl-sm border border-white/8">
              <div className="flex gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="px-3 py-3 border-t border-white/5">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('chat.placeholder', lang)}
            className="chat-input flex-1 px-3 py-2.5 text-xs rounded-xl"
            disabled={chatLoading}
          />
          <button
            onClick={handleSend}
            disabled={chatLoading || !input.trim()}
            aria-label={t('chat.send', lang)}
            className="btn-star px-3 py-2.5 text-xs disabled:opacity-30 disabled:cursor-not-allowed rounded-xl"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

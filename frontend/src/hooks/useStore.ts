import { create } from 'zustand';
import type { AppState, AppEvent, AppToast } from '../types';
import { CONSTELLATION_NAMES } from '../constants';
import {
  clampSatelliteCount,
  clampTimeSpeed,
  clampCommRangeKm,
  clampOrbitAltitudeKm,
  clampOrbitalPlanes,
  clampInclinationDeg,
} from '../lib/clamps';

let _highlightTimer: ReturnType<typeof setTimeout> | null = null;

const MAX_EVENTS = 80;
const MAX_TOASTS = 4;
let _idCounter = 0;
const nextId = (prefix: string) => `${prefix}_${++_idCounter}_${Date.now()}`;

function clampPlanesForSatelliteCount(planes: number, satelliteCount: number): number {
  return Math.max(1, Math.min(clampOrbitalPlanes(planes), clampSatelliteCount(satelliteCount)));
}

export const useStore = create<AppState>((set, get) => ({
  // Language
  lang: (typeof navigator !== 'undefined' && navigator.language?.startsWith('en') ? 'en' : 'ru') as 'ru' | 'en',

  // Data
  satellites: [],
  positions: [],
  orbitPaths: {},
  tleData: [],
  userError: null,

  // Controls
  timeSpeed: 1,
  showOrbits: true,
  showLabels: true,
  showCoverage: false,
  showLinks: true,
  selectedSatellite: null,
  focusedSatellite: null,
  cameraFollowing: false,
  highlightedConstellation: null,
  activeConstellations: [...CONSTELLATION_NAMES],
  satelliteCount: 15,
  orbitAltitudeKm: 0,
  tleSource: 'embedded',
  commRangeKm: 2000,
  activeLinksCount: 0,
  orbitalPlanes: 3,
  inclinationDeg: 55,

  // Trust / freshness
  tleMeta: null,
  backendHealth: null,
  backendReachable: true,
  lastHealthCheckAt: null,

  // Events & toasts
  events: [],
  toasts: [],

  // Chat
  chatOpen: false,
  chatMessages: [],
  chatLoading: false,

  // Actions
  setLang: (lang) => set({ lang }),
  setTimeSpeed: (speed) => set({ timeSpeed: clampTimeSpeed(speed) }),
  setShowOrbits: (show) => set({ showOrbits: show }),
  setShowLabels: (show) => set({ showLabels: show }),
  setShowCoverage: (show) => set({ showCoverage: show }),
  setShowLinks: (show) => set({ showLinks: show }),
  setUserError: (err) => set({ userError: err }),
  selectSatellite: (id) => {
    if (id === null) {
      set({ selectedSatellite: null, focusedSatellite: null, cameraFollowing: false });
      return;
    }
    const sat = get().satellites.find((s) => s.norad_id === id);
    if (sat && sat.operational === false) return;
    set({ selectedSatellite: id });
  },
  focusSatellite: (id) => {
    if (id === null) {
      set({ selectedSatellite: null, focusedSatellite: null, cameraFollowing: false });
      return;
    }
    const sat = get().satellites.find((s) => s.norad_id === id);
    if (sat && sat.operational === false) {
      set({
        userError: get().lang === 'en'
          ? `Cannot focus: ${sat.name} is archival (${sat.status})`
          : `Нельзя навести камеру: ${sat.name} — архивный (${sat.status})`,
      });
      return;
    }
    set({ focusedSatellite: id, selectedSatellite: id, cameraFollowing: true });
  },
  setCameraFollowing: (following) => set({ cameraFollowing: following }),
  highlightConstellation: (name) => {
    set({ highlightedConstellation: name });
    // Cancel previous timer to prevent stacking timeouts on rapid highlights
    if (_highlightTimer !== null) {
      clearTimeout(_highlightTimer);
      _highlightTimer = null;
    }
    // Auto-reset after 30 s so the rest of the constellation doesn't stay dimmed forever
    if (name !== null) {
      _highlightTimer = setTimeout(() => {
        _highlightTimer = null;
        if (get().highlightedConstellation === name) {
          set({ highlightedConstellation: null });
        }
      }, 30000);
    }
  },
  toggleConstellation: (name) =>
    set((state) => ({
      activeConstellations: state.activeConstellations.includes(name)
        ? state.activeConstellations.filter((c) => c !== name)
        : [...state.activeConstellations, name],
    })),
  setSatelliteCount: (count) =>
    set((state) => {
      const satelliteCount = clampSatelliteCount(count);
      return {
        satelliteCount,
        orbitalPlanes: clampPlanesForSatelliteCount(state.orbitalPlanes, satelliteCount),
      };
    }),
  setTleSource: (source) => set({ tleSource: source }),
  setOrbitAltitudeKm: (km) => set({ orbitAltitudeKm: clampOrbitAltitudeKm(km) }),
  setCommRangeKm: (km) => set({ commRangeKm: clampCommRangeKm(km) }),
  setActiveLinksCount: (count) =>
    set({ activeLinksCount: Math.max(0, Math.floor(count) || 0) }),
  setOrbitalPlanes: (planes) =>
    set((state) => ({
      orbitalPlanes: clampPlanesForSatelliteCount(planes, state.satelliteCount),
    })),
  setInclinationDeg: (deg) => set({ inclinationDeg: clampInclinationDeg(deg) }),
  setChatOpen: (open) => set({ chatOpen: open }),
  addChatMessage: (msg) =>
    set((state) => {
      const messages = [...state.chatMessages, msg];
      // Limit chat history to 50 messages
      return { chatMessages: messages.length > 50 ? messages.slice(-50) : messages };
    }),
  setChatLoading: (loading) => set({ chatLoading: loading }),
  setSatellites: (sats) => set({ satellites: sats }),
  setPositions: (pos) => set({ positions: pos }),
  setOrbitPath: (id, path) =>
    set((state) => ({ orbitPaths: { ...state.orbitPaths, [id]: path } })),
  setOrbitPaths: (paths) => set({ orbitPaths: paths }),
  setTleData: (data) => set({ tleData: data }),
  setTleMeta: (meta) => set({ tleMeta: meta }),
  setBackendHealth: (health, reachable) =>
    set({ backendHealth: health, backendReachable: reachable, lastHealthCheckAt: Date.now() }),
  logEvent: (event) =>
    set((state) => {
      const next: AppEvent = {
        ...event,
        id: nextId('evt'),
        timestamp: Date.now(),
      };
      const events = [next, ...state.events];
      return { events: events.length > MAX_EVENTS ? events.slice(0, MAX_EVENTS) : events };
    }),
  clearEvents: () => set({ events: [] }),
  pushToast: (toast) =>
    set((state) => {
      const next: AppToast = {
        ...toast,
        id: nextId('toast'),
        createdAt: Date.now(),
      };
      const toasts = [next, ...state.toasts];
      return { toasts: toasts.length > MAX_TOASTS ? toasts.slice(0, MAX_TOASTS) : toasts };
    }),
  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  resetView: () =>
    set({
      selectedSatellite: null,
      focusedSatellite: null,
      cameraFollowing: false,
      highlightedConstellation: null,
      timeSpeed: 1,
      showOrbits: true,
      showLabels: true,
      showCoverage: false,
      showLinks: true,
      activeConstellations: [...CONSTELLATION_NAMES],
      userError: null,
      satelliteCount: 15,
      tleSource: 'embedded',
      orbitAltitudeKm: 0,
      commRangeKm: 2000,
      orbitalPlanes: 3,
      inclinationDeg: 55,
    }),
}));

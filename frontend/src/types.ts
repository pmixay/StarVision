// ── Satellite Types ──────────────────────────────────────────────────

export interface SatelliteData {
  norad_id: number;
  name: string;
  constellation: string;
  purpose: string;
  mass_kg: number;
  form_factor: string;
  launch_date: string;
  status: string;
  operational: boolean;
  archive_date?: string | null;
  description: string;
}

export interface TLEData {
  norad_id: number;
  name: string;
  constellation: string;
  tle_line1: string;
  tle_line2: string;
  source?: 'celestrak' | 'embedded' | 'embedded_fallback' | string;
}

export type EffectiveTleSource =
  | 'embedded'
  | 'celestrak'
  | 'celestrak_partial'
  | 'embedded_fallback';

export interface TleResponseMeta {
  requested_source: 'embedded' | 'celestrak';
  effective_source: EffectiveTleSource;
  operational_only: boolean;
  fetched_at: string;
  cache_age_sec: number | null;
  network_error: boolean;
  fallback_count: number;
  live_count: number;
  total: number;
}

export interface APITleResponse {
  tle_data: TLEData[];
  source: 'embedded' | 'celestrak';
  meta: TleResponseMeta;
  refreshed?: boolean;
}

export interface HealthCatalog {
  total: number;
  operational: number;
  archival: number;
}

export interface HealthCelestrakCache {
  warm: boolean;
  age_sec: number | null;
  entries: number;
}

export interface APIHealthResponse {
  status: 'ok' | string;
  version?: string;
  time?: string;
  timestamp?: string | null;
  reasons?: string[];
  catalog?: HealthCatalog;
  celestrak_cache?: HealthCelestrakCache;
  tle_cache?: Record<string, unknown>;
}

export interface SatellitePosition {
  norad_id: number;
  name: string;
  eci: { x: number; y: number; z: number };
  velocity: { vx: number; vy: number; vz: number };
  altitude_km: number;
  speed_km_s: number;
  period_min: number;
  lat: number;
  lon: number;
  timestamp: string;
}

export interface OrbitPoint {
  x: number;
  y: number;
  z: number;
}

// ── UI State ────────────────────────────────────────────────────────

export interface AppState {
  // Language
  lang: 'ru' | 'en';

  // Data
  satellites: SatelliteData[];
  positions: SatellitePosition[];
  orbitPaths: Record<number, OrbitPoint[]>;
  tleData: TLEData[];
  userError: string | null;

  // Controls
  timeSpeed: number;
  showOrbits: boolean;
  showLabels: boolean;
  showCoverage: boolean;
  showLinks: boolean;
  selectedSatellite: number | null;
  focusedSatellite: number | null;
  cameraFollowing: boolean;
  highlightedConstellation: string | null;
  activeConstellations: string[];
  satelliteCount: number;
  tleSource: 'embedded' | 'celestrak';  // TLE data source
  orbitAltitudeKm: number;   // 0 = real TLE; >0 = virtual circular orbits
  commRangeKm: number;       // communication range threshold (50–2000 km per spec)
  activeLinksCount: number;  // current number of active ISL
  orbitalPlanes: number;     // number of orbital planes (1–7)
  orbitInclinationDeg: number; // virtual Walker inclination (0..180°)

  // Data-trust metadata
  tleMeta: TleResponseMeta | null;
  backendHealth: APIHealthResponse | null;
  backendReachable: boolean;
  lastHealthCheckAt: number | null;
  networkAnalytics: NetworkAnalytics | null;

  // Event log / notifications
  events: AppEvent[];
  toasts: AppToast[];

  // StarAI
  chatOpen: boolean;
  chatMessages: ChatMessage[];
  chatLoading: boolean;

  // Actions
  setLang: (lang: 'ru' | 'en') => void;
  setTimeSpeed: (speed: number) => void;
  setShowOrbits: (show: boolean) => void;
  setShowLabels: (show: boolean) => void;
  setShowCoverage: (show: boolean) => void;
  setShowLinks: (show: boolean) => void;
  selectSatellite: (id: number | null) => void;
  focusSatellite: (id: number | null) => void;
  setCameraFollowing: (following: boolean) => void;
  highlightConstellation: (name: string | null) => void;
  toggleConstellation: (name: string) => void;
  setSatelliteCount: (count: number) => void;
  setTleSource: (source: 'embedded' | 'celestrak') => void;
  setOrbitAltitudeKm: (km: number) => void;
  setCommRangeKm: (km: number) => void;
  setActiveLinksCount: (count: number) => void;
  setOrbitalPlanes: (planes: number) => void;
  setOrbitInclinationDeg: (deg: number) => void;
  setChatOpen: (open: boolean) => void;
  addChatMessage: (msg: ChatMessage) => void;
  setChatLoading: (loading: boolean) => void;
  setTleMeta: (meta: TleResponseMeta | null) => void;
  setBackendHealth: (health: APIHealthResponse | null, reachable: boolean) => void;
  setNetworkAnalytics: (n: NetworkAnalytics | null) => void;
  setUserError: (err: string | null) => void;
  logEvent: (event: Omit<AppEvent, 'id' | 'timestamp'>) => void;
  clearEvents: () => void;
  pushToast: (toast: Omit<AppToast, 'id' | 'createdAt'>) => void;
  dismissToast: (id: string) => void;
  setSatellites: (sats: SatelliteData[]) => void;
  setPositions: (pos: SatellitePosition[]) => void;
  setOrbitPath: (id: number, path: OrbitPoint[]) => void;
  setOrbitPaths: (paths: Record<number, OrbitPoint[]>) => void;
  setTleData: (data: TLEData[]) => void;
  resetView: () => void;
}

// ── Events & toasts ────────────────────────────────────────────────
export type EventLevel = 'info' | 'success' | 'warning' | 'error';
export type EventKind =
  | 'tle_loaded'
  | 'tle_fallback'
  | 'tle_source_switched'
  | 'tle_refresh'
  | 'starai_action'
  | 'starai_error'
  | 'health_degraded'
  | 'health_restored'
  | 'collision_forecast'
  | 'optimizer_apply'
  | 'api_error';

export interface AppEvent {
  id: string;
  timestamp: number;
  level: EventLevel;
  kind: EventKind;
  message: string;
  details?: string;
}

export interface AppToast {
  id: string;
  createdAt: number;
  level: EventLevel;
  title: string;
  detail?: string;
  ttlMs?: number;
}

// ── Chat ────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  actions?: StarAIAction[];
  timestamp: number;
}

export interface StarAIAction {
  type: string;
  [key: string]: any;
}

// ── API Responses ───────────────────────────────────────────────────

export interface APIPositionsResponse {
  positions: SatellitePosition[];
  timestamp: string;
  source?: string;
}

export interface APISatellitesResponse {
  satellites: SatelliteData[];
  count: number;
}

export interface APIOrbitResponse {
  norad_id: number;
  name: string;
  path: OrbitPoint[];
  steps: number;
  source?: string;
}

export interface APIOrbitsBatchResponse {
  paths: Record<number, OrbitPoint[]>;
  names: Record<number, string>;
  steps: number;
  step_sec: number;
  source?: string;
  meta?: TleResponseMeta;
}

export interface APIChatResponse {
  message: string;
  actions: StarAIAction[];
  rejected_actions?: string[];
}

export interface NetworkAnalytics {
  connected_components: number;
  largest_component_size: number;
  avg_degree: number;
  diameter: number | null;
  is_connected: boolean;
}

export interface APILinksResponse {
  links: Array<{
    norad_id_1: number;
    norad_id_2: number;
    name_1: string;
    name_2: string;
    distance_km: number;
    los: boolean;
    connected: boolean;
  }>;
  active_count: number;
  total_pairs: number;
  satellites_count: number;
  blocked_by_earth: number;
  in_range_no_los: number;
  comm_range_km: number;
  network?: NetworkAnalytics;
  timestamp: string;
  source: string;
  meta?: TleResponseMeta;
}

export interface CollisionApproach {
  norad_id_1: number;
  name_1: string;
  norad_id_2: number;
  name_2: string;
  min_distance_km: number;
  time_of_closest_approach: string;
  risk_level: 'critical' | 'warning' | 'safe' | string;
}

export interface APICollisionsResponse {
  close_approaches: CollisionApproach[];
  count: number;
  threshold_km: number;
  hours_ahead: number;
  source: string;
  timestamp: string;
}

export interface OptimizerPlane {
  plane_index: number;
  raan_deg: number;
  satellites_count: number;
  satellites: Array<{ index: number; mean_anomaly_deg: number }>;
}

export interface APIOptimizerObjective {
  score: number;
  phase_uniformity: number;
  raan_uniformity: number;
  coverage_fraction: number;
  samples_per_period: number;
  candidates_evaluated: number;
}

export interface APIOptimizerResponse {
  walker_notation: string;
  total_satellites: number;
  num_planes: number;
  sats_per_plane: number;
  phase_factor: number;
  altitude_km: number;
  inclination_deg: number;
  orbital_period_min: number;
  velocity_km_s: number;
  planes: OptimizerPlane[];
  /** Present when the backend evaluated the F-search objective. */
  objective?: APIOptimizerObjective;
  coverage_note: string;
}

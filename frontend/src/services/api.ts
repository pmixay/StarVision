/**
 * api.ts — StarVision Backend API client.
 *
 * All fetchers throw `ApiError` on non-2xx, which callers can inspect for
 * status/detail rather than losing information in a generic Error.
 */

import type {
  APISatellitesResponse,
  APIPositionsResponse,
  APIOrbitResponse,
  APIOrbitsBatchResponse,
  APIChatResponse,
  APITleResponse,
  APIHealthResponse,
  APICollisionsResponse,
  APIOptimizerResponse,
  ChatMessage,
} from '../types';

const BASE_URL = '/api';

export class ApiError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(`API ${status}: ${detail}`);
    this.status = status;
    this.detail = detail;
  }
}

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${url}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch (e) {
    throw new ApiError(0, e instanceof Error ? e.message : 'network error');
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (body?.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
    } catch {
      // body may not be JSON; keep statusText
    }
    throw new ApiError(res.status, detail);
  }
  return res.json();
}

// ── Satellites ──────────────────────────────────────────────────────

export async function fetchSatellites(): Promise<APISatellitesResponse> {
  return fetchJSON('/satellites');
}

export async function fetchPositions(
  timestamp?: string,
  source: 'embedded' | 'celestrak' = 'embedded',
): Promise<APIPositionsResponse> {
  const params = new URLSearchParams();
  if (timestamp) params.set('timestamp', timestamp);
  if (source !== 'embedded') params.set('source', source);
  const query = params.toString() ? `?${params}` : '';
  return fetchJSON(`/positions${query}`);
}

export async function fetchOrbitPath(
  noradId: number,
  steps = 120,
  stepSec = 60,
  source: 'embedded' | 'celestrak' = 'embedded',
): Promise<APIOrbitResponse> {
  const params = new URLSearchParams({
    steps: String(steps),
    step_sec: String(stepSec),
  });
  if (source !== 'embedded') params.set('source', source);
  return fetchJSON(`/orbit/${noradId}?${params}`);
}

export async function fetchAllOrbitPaths(
  steps = 120,
  stepSec = 60,
  source: 'embedded' | 'celestrak' = 'embedded',
): Promise<APIOrbitsBatchResponse> {
  const params = new URLSearchParams({
    steps: String(steps),
    step_sec: String(stepSec),
  });
  if (source !== 'embedded') params.set('source', source);
  return fetchJSON<APIOrbitsBatchResponse>(`/orbits?${params}`);
}

export async function fetchTLE(
  source: 'embedded' | 'celestrak' = 'embedded',
): Promise<APITleResponse> {
  return fetchJSON<APITleResponse>(`/tle?source=${source}`);
}

export async function refreshTLE(): Promise<APITleResponse> {
  return fetchJSON<APITleResponse>('/tle/refresh', { method: 'POST' });
}

export async function fetchHealth(): Promise<APIHealthResponse> {
  return fetchJSON<APIHealthResponse>('/health');
}

export async function fetchCollisions(
  thresholdKm = 100,
  hoursAhead = 24,
  source: 'embedded' | 'celestrak' = 'embedded',
): Promise<APICollisionsResponse> {
  const params = new URLSearchParams({
    threshold_km: String(thresholdKm),
    hours_ahead: String(hoursAhead),
  });
  if (source !== 'embedded') params.set('source', source);
  return fetchJSON<APICollisionsResponse>(`/collisions?${params}`);
}

export async function fetchOptimizePlanes(opts: {
  num_satellites: number;
  num_planes: number;
  altitude_km: number;
  inclination_deg?: number;
}): Promise<APIOptimizerResponse> {
  const params = new URLSearchParams({
    num_satellites: String(opts.num_satellites),
    num_planes: String(opts.num_planes),
    altitude_km: String(opts.altitude_km),
    inclination_deg: String(opts.inclination_deg ?? 55.0),
  });
  return fetchJSON<APIOptimizerResponse>(`/optimize-planes?${params}`);
}

// ── StarAI ──────────────────────────────────────────────────────────

const MAX_CHAT_HISTORY_ITEMS = 30;

export async function sendChatMessage(
  message: string,
  history: ChatMessage[],
  lang: string = 'ru',
): Promise<APIChatResponse> {
  const boundedHistory = history.slice(-MAX_CHAT_HISTORY_ITEMS);
  const body: Record<string, unknown> = {
    message,
    history: boundedHistory.map((m) => ({ role: m.role, content: m.content })),
    lang,
  };
  return fetchJSON('/starai/chat', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

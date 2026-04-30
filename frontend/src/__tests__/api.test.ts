import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTLE, sendChatMessage } from '../services/api';
import type { ChatMessage } from '../types';

describe('sendChatMessage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('trims history to the backend chat limit', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ message: 'ok', actions: [] }),
    } as Response);
    const history: ChatMessage[] = Array.from({ length: 50 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg ${i}`,
      timestamp: i,
    }));

    await sendChatMessage('current', history, 'ru');

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body)) as { history: Array<{ content: string }> };

    expect(body.history).toHaveLength(30);
    expect(body.history[0].content).toBe('msg 20');
    expect(body.history[body.history.length - 1].content).toBe('msg 49');
  });
});

describe('fetchTLE source query', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes the requested source through to the backend', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ tle_data: [], source: 'celestrak', meta: {} }),
    } as Response);

    await fetchTLE('celestrak');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('source=celestrak');
  });

  it('defaults to embedded when no source is supplied', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ tle_data: [], source: 'embedded', meta: {} }),
    } as Response);

    await fetchTLE();

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('source=embedded');
  });
});

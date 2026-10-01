import { describe, expect, it, vi } from 'vitest';

import { fetchGoogleQuota } from './index.js';

const ANTIGRAVITY_SOURCE = {
  sourceId: 'antigravity',
  sourceLabel: 'Antigravity',
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  projectId: 'project-a'
};

// Trimmed capture of v1internal:retrieveUserQuotaSummary: two pools, each with a Five Hour and
// a Weekly bucket.
const SUMMARY_PAYLOAD = {
  groups: [
    {
      displayName: 'Gemini Models',
      buckets: [
        { bucketId: 'gemini-weekly', window: 'weekly', remainingFraction: 0.9763771, resetTime: '2026-10-01T21:35:04Z' },
        { bucketId: 'gemini-5h', window: '5h', remainingFraction: 0.8582628, resetTime: '2026-09-25T16:02:51Z' }
      ]
    },
    {
      displayName: 'Claude and GPT models',
      buckets: [
        { bucketId: '3p-weekly', window: 'weekly', remainingFraction: 0.6375601, resetTime: '2026-09-27T18:42:36Z' },
        { bucketId: '3p-5h', window: '5h', remainingFraction: 1, resetTime: '2026-09-25T18:13:18Z' }
      ]
    }
  ]
};

const jsonResponse = (body) => ({
  ok: true,
  status: 200,
  headers: new Headers(),
  json: async () => body
});

const errorResponse = (status) => ({
  ok: false,
  status,
  headers: new Headers(),
  json: async () => ({})
});

const requestQuota = async ({ payload, sources = [ANTIGRAVITY_SOURCE], refresh = vi.fn() } = {}) => {
  const fetchImpl = payload instanceof Error
    ? vi.fn().mockRejectedValue(payload)
    : vi.fn().mockResolvedValue(payload);

  const result = await fetchGoogleQuota({
    readAuthSources: () => sources,
    refreshAccessToken: refresh,
    fetchImpl
  });

  return { fetchImpl, refresh, result };
};

describe('Google quota provider', () => {
  it('reports not configured when no auth source resolves', async () => {
    const { result } = await requestQuota({ sources: [] });

    expect(result.configured).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.usage).toBeNull();
  });

  it('maps the summary into provider-level windows only', async () => {
    const { result } = await requestQuota({ payload: jsonResponse(SUMMARY_PAYLOAD) });

    expect(result.ok).toBe(true);
    expect(result.usage.windows['7d'].remainingPercent).toBeCloseTo(97.64, 1);
    expect(result.usage.windows['5h'].remainingPercent).toBeCloseTo(85.83, 1);
    expect(result.usage.windows['7d'].windowSeconds).toBe(7 * 24 * 60 * 60);
    expect(result.usage.windows['5h'].windowSeconds).toBe(5 * 60 * 60);

    // The second pool ("Claude and GPT models") is deliberately not surfaced as a row.
    expect(result.usage.models).toEqual({});
  });

  it('reports every window with a usable countdown and formatted reset', async () => {
    const { result } = await requestQuota({ payload: jsonResponse(SUMMARY_PAYLOAD) });

    const windows = [
      ...Object.values(result.usage.windows)
    ];

    expect(windows).toHaveLength(2);
    for (const window of windows) {
      expect(window.remainingPercent).toBeGreaterThanOrEqual(0);
      expect(window.remainingPercent).toBeLessThanOrEqual(100);
      expect(window.resetAfterSeconds).toBeGreaterThanOrEqual(0);
      expect(window.resetAtFormatted).toMatch(/\S/);
      expect(window.resetAfterFormatted).toMatch(/\S/);
    }
  });

  it('sends the Antigravity agent string, which the endpoint gates on', async () => {
    const { fetchImpl } = await requestQuota({ payload: jsonResponse(SUMMARY_PAYLOAD) });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain('retrieveUserQuotaSummary');
    expect(init.headers['User-Agent']).toBe('antigravity/1.11.5 windows/amd64');
    expect(init.headers.Authorization).toBe('Bearer access-token');
  });

  it('drops buckets that cannot produce a usable window and keeps the rest', async () => {
    const { result } = await requestQuota({
      payload: jsonResponse({
        groups: [
          {
            displayName: 'Gemini Models',
            buckets: [
              { window: '5h', remainingFraction: Number.NaN, resetTime: '2026-09-25T16:02:51Z' },
              { window: 'weekly', remainingFraction: 0.5, resetTime: 'not-a-date' }
            ]
          },
          {
            displayName: 'Claude and GPT models',
            buckets: [{ window: 'weekly', remainingFraction: 1, resetTime: '2026-09-27T18:42:36Z' }]
          }
        ]
      })
    });

    expect(result.ok).toBe(true);
    expect(result.usage.models).toEqual({});
    expect(result.usage.windows['7d'].remainingPercent).toBe(100);
  });

  it('reports an authorisation failure instead of empty usage', async () => {
    const { result } = await requestQuota({ payload: errorResponse(403) });

    expect(result.ok).toBe(false);
    expect(result.configured).toBe(true);
    expect(result.usage).toBeNull();
    expect(result.error).toContain('not authorised');
  });

  it('surfaces a network failure instead of an empty successful result', async () => {
    const { result } = await requestQuota({ payload: new Error('socket hang up') });

    expect(result.ok).toBe(false);
    expect(result.usage).toBeNull();
    expect(result.error).toContain('quota request failed');
  });

  it('refreshes an expired token before calling the summary', async () => {
    const refresh = vi.fn().mockResolvedValue('fresh-token');
    const { fetchImpl } = await requestQuota({
      payload: jsonResponse(SUMMARY_PAYLOAD),
      sources: [{ ...ANTIGRAVITY_SOURCE, accessToken: null, expires: 1 }],
      refresh
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer fresh-token');
  });
});

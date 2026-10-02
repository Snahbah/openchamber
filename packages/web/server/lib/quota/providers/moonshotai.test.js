import { describe, expect, it } from 'vitest';
import { fetchQuota, isConfigured } from './moonshotai.js';

const readAuth = () => ({ moonshotai: { type: 'api', key: 'test-token' } });

// Captured from GET https://api.moonshot.ai/v1/users/me/balance (amounts in USD).
const LIVE_PAYLOAD = {
  code: 0,
  data: { available_balance: 49.67646, voucher_balance: 0, cash_balance: 49.67646 },
  scode: '0x0',
  status: true,
};

describe('Moonshot AI quota provider', () => {
  it('is configured only by a moonshotai API key', () => {
    expect(isConfigured(readAuth())).toBe(true);
    expect(isConfigured({ moonshotai: { key: '  ' } })).toBe(false);
    expect(isConfigured({})).toBe(false);
  });

  it('reports the available balance as a credits_balance window', async () => {
    const calls = [];
    const result = await fetchQuota({
      readAuth,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return Response.json(LIVE_PAYLOAD);
      },
    });

    expect(calls[0].url).toBe('https://api.moonshot.ai/v1/users/me/balance');
    expect(calls[0].init.headers.Authorization).toBe('Bearer test-token');
    expect(result.ok).toBe(true);
    expect(result.providerId).toBe('moonshotai');
    expect(result.providerName).toBe('Moonshot AI');
    const window = result.usage.windows.credits_balance;
    expect(window.valueLabel).toBe('$49.68');
    expect(window.usedPercent).toBeNull();
    expect(window.resetAt).toBeNull();
  });

  it('a zero balance is a real value, not missing data', async () => {
    const result = await fetchQuota({
      readAuth,
      fetchImpl: async () => Response.json({ ...LIVE_PAYLOAD, data: { available_balance: 0 } }),
    });

    expect(result.ok).toBe(true);
    expect(result.usage.windows.credits_balance.valueLabel).toBe('$0.00');
  });

  it.each([{}, { data: {} }, { data: { available_balance: '12' } }, { data: null }])(
    'a payload without a numeric balance is a failed refresh: %j',
    async (payload) => {
      const result = await fetchQuota({ readAuth, fetchImpl: async () => Response.json(payload) });

      expect(result.ok).toBe(false);
      expect(result.configured).toBe(true);
      expect(result.error).toBe('No quota data in response');
    },
  );

  it('an auth failure asks the user to re-authenticate', async () => {
    const result = await fetchQuota({
      readAuth,
      fetchImpl: async () => new Response('{}', { status: 401 }),
    });

    expect(result.ok).toBe(false);
    expect(result.configured).toBe(true);
    expect(result.error).toContain('re-authenticate with Moonshot AI');
  });

  it('no key means not configured, and nothing is fetched', async () => {
    let fetched = false;
    const result = await fetchQuota({
      readAuth: () => ({}),
      fetchImpl: async () => {
        fetched = true;
        return Response.json(LIVE_PAYLOAD);
      },
    });

    expect(fetched).toBe(false);
    expect(result.configured).toBe(false);
  });
});

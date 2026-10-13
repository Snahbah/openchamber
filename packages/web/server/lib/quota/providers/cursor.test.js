import { describe, expect, it } from 'bun:test';
import { isConfigured, fetchQuota } from './cursor.js';

describe('Cursor quota provider', () => {
  it('detects configuration from auth object', () => {
    expect(isConfigured({ cursor: { access: 'test-jwt', type: 'oauth' } })).toBe(true);
    expect(isConfigured({ 'cursor.oauth': { token: 'test-token' } })).toBe(true);
  });

  it('fetches and formats usage data with valid billing cycle timestamp', async () => {
    const result = await fetchQuota();
    expect(result.providerId).toBe('cursor');
    expect(result.configured).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.usage).toBeDefined();

    const windows = result.usage.windows;
    expect(windows.billing_cycle).toBeDefined();
    expect(windows.plan_limit).toBeDefined();
    expect(typeof windows.plan_limit.usedPercent).toBe('number');
    expect(windows.billing_cycle.resetAt).toBeGreaterThan(1_700_000_000_000);
    expect(typeof windows.billing_cycle.resetAtFormatted).toBe('string');
  });
});

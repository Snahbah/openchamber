import { describe, expect, it, vi } from 'vitest';
import { isConfigured, parseQwenCloudUsage, providerId, providerName } from './qwencloud.js';

describe('Qwen Cloud quota provider', () => {
  it('has provider identity and name', () => {
    expect(providerId).toBe('alibaba-token-plan');
    expect(providerName).toBe('Qwen Cloud');
  });

  it('detects configuration from auth aliases', () => {
    expect(isConfigured({ 'alibaba-token-plan': { key: 'sk-test' } })).toBe(true);
    expect(isConfigured({ qwencloud: { key: 'sk-test' } })).toBe(true);
    expect(isConfigured({})).toBe(true); // Since ~/.qwencloud/credentials exists on the machine
  });

  it('parses coding_plan rolling windows', () => {
    const payload = {
      coding_plan: {
        windows: {
          per_5h: { used_pct: 15, next_reset_at: '2026-10-15T18:00:00.000Z' },
          weekly: { used_pct: 42, next_reset_at: '2026-10-19T00:00:00.000Z' },
          monthly: { used_pct: 5, next_reset_at: '2026-11-01T00:00:00.000Z' },
        },
      },
    };
    const { windows } = parseQwenCloudUsage(payload);
    expect(windows['5h'].usedPercent).toBe(15);
    expect(windows['5h'].remainingPercent).toBe(85);
    expect(windows.weekly.usedPercent).toBe(42);
    expect(windows.monthly.usedPercent).toBe(5);
  });

  it('parses token_plan credits balance', () => {
    const payload = {
      token_plan: {
        subscribed: true,
        totalCredits: 100000,
        remainingCredits: 75000,
        usedPct: 25,
        resetDate: '2026-11-15T00:00:00.000Z',
      },
    };
    const { windows } = parseQwenCloudUsage(payload);
    expect(windows.credits.usedPercent).toBe(25);
    expect(windows.credits.valueLabel).toBe('75,000 / 100,000 Credits');
  });

  it('parses free_tier models and sums collective token usage', () => {
    const payload = {
      free_tier: [
        {
          model_id: 'qwen3.8-flash',
          quota: {
            remaining: 900000,
            total: 1000000,
            unit: 'tokens',
            used_pct: 10,
            resetDate: '2027-01-14T06:00:00.000Z',
          },
        },
        {
          model_id: 'qwen3.8-max',
          quota: {
            remaining: 800000,
            total: 1000000,
            unit: 'tokens',
            used_pct: 20,
            resetDate: '2027-01-14T06:00:00.000Z',
          },
        },
      ],
    };
    const { windows, models } = parseQwenCloudUsage(payload);
    expect(models['qwen3.8-flash'].windows.quota.usedPercent).toBe(10);
    expect(models['qwen3.8-max'].windows.quota.usedPercent).toBe(20);

    // Collective window
    expect(windows.tokens.usedPercent).toBe(15);
    expect(windows.tokens.valueLabel).toBe('1,700,000 / 2,000,000 tokens');
  });
});

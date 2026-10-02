import { describe, expect, test } from 'bun:test';

import { formatUsageRowReset, formatUsageRowValue, type UsageLimitRow } from './usageGroups';

const row = (overrides: Partial<UsageLimitRow> = {}): UsageLimitRow => ({
  key: 'window-7d',
  label: 'Weekly limit remaining',
  window: {
    usedPercent: 87.76,
    remainingPercent: 12.24,
    windowSeconds: 7 * 24 * 60 * 60,
    resetAfterSeconds: null,
    resetAt: Date.now() + (2 * 86400 + 4 * 3600 + 30 * 60) * 1000,
    resetAtFormatted: '22:35',
    resetAfterFormatted: '22:35',
  },
  ...overrides,
});

describe('usage row formatting', () => {
  test('a remaining-with-countdown row shows the remaining percent in either display mode', () => {
    const agyRow = row({ remainingWithCountdown: true });
    expect(formatUsageRowValue(agyRow, 'usage')).toBe('12%');
    expect(formatUsageRowValue(agyRow, 'remaining')).toBe('12%');
  });

  test('an ordinary row follows the display mode', () => {
    expect(formatUsageRowValue(row(), 'usage')).toBe('88%');
    expect(formatUsageRowValue(row(), 'remaining')).toBe('12%');
  });

  test('a remaining-with-countdown row shows time until reset even days away', () => {
    expect(formatUsageRowReset(row({ remainingWithCountdown: true }), 'auto')).toBe('in 2d 4h');
  });

  test('a remaining-with-countdown row past its reset falls back to the formatted reset', () => {
    const stale = row({ remainingWithCountdown: true });
    stale.window.resetAt = Date.now() - 60_000;
    expect(formatUsageRowReset(stale, 'auto').startsWith('in ')).toBe(false);
  });
});

import { describe, expect, test } from 'bun:test';

import { clampPercent, formatPercent, formatWindowLabel, formatResetCountdown, formatQuotaResetLabel } from './utils';

describe('quota utils', () => {
  test('treats non-finite percentages as missing', () => {
    expect(clampPercent(Infinity)).toBeNull();
    expect(clampPercent(-Infinity)).toBeNull();

    expect(formatPercent(Infinity)).toBe('-');
    expect(formatPercent(-Infinity)).toBe('-');
  });

  test('labels Copilot usage as AI Credits without changing generic premium usage', () => {
    expect(formatWindowLabel('premium')).toBe('Premium Interactions');
    expect(formatWindowLabel('premium_interactions')).toBe('AI Credits');
  });

  test('formats a relative reset countdown', () => {
    expect(formatResetCountdown(5 * 3600 + 19 * 60)).toBe('in 5h 19m');
    expect(formatResetCountdown(4 * 3600 + 11 * 60)).toBe('in 4h 11m');
    expect(formatResetCountdown(90)).toBe('in 1m');
    expect(formatResetCountdown(30)).toBe('in 30s');
    expect(formatResetCountdown(2 * 86400 + 4 * 3600 + 59 * 60)).toBe('in 2d 4h');
  });

  test('shows a countdown, not a bare clock time, for a reset later today', () => {
    const now = new Date();
    const later = new Date(now.getTime() + 30 * 60 * 1000); // +30m
    if (later.toDateString() !== now.toDateString()) return; // midnight edge: skip
    const label = formatQuotaResetLabel(later.getTime());
    expect(label.startsWith('in ')).toBe(true); // countdown, not "21:35" or a date
  });
});

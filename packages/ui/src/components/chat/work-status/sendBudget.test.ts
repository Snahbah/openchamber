import { describe, expect, test } from 'bun:test';
import { estimatePromptTokens, evaluateSendBudget } from './sendBudget';
import { DEFAULT_CONTEXT_LIMIT } from './contextUsage';

describe('evaluateSendBudget', () => {
  test('I1 blocks when estimated tokens exceed the resolved limit', () => {
    const result = evaluateSendBudget({ estimatedTokens: 101, contextLimit: 100 });
    expect(result.allowed).toBe(false);
  });

  test('I2 allows when estimated tokens are under the resolved limit', () => {
    const result = evaluateSendBudget({ estimatedTokens: 99, contextLimit: 100 });
    expect(result.allowed).toBe(true);
  });

  test('I3 allows equality at the resolved limit boundary', () => {
    const result = evaluateSendBudget({ estimatedTokens: 100, contextLimit: 100 });
    expect(result.allowed).toBe(true);
  });

  test('I4 falls back to the default limit when contextLimit is zero', () => {
    const over = evaluateSendBudget({ estimatedTokens: DEFAULT_CONTEXT_LIMIT + 1, contextLimit: 0 });
    expect(over.allowed).toBe(false);
    expect(over.resolvedLimit).toBe(DEFAULT_CONTEXT_LIMIT);

    const atLimit = evaluateSendBudget({ estimatedTokens: DEFAULT_CONTEXT_LIMIT, contextLimit: 0 });
    expect(atLimit.allowed).toBe(true);
  });

  test('I5 uses the real positive limit as the resolved limit', () => {
    const result = evaluateSendBudget({ estimatedTokens: 500, contextLimit: 400 });
    expect(result.allowed).toBe(false);
    expect(result.resolvedLimit).toBe(400);
  });

  test('I6 names the reason on a blocked result', () => {
    const result = evaluateSendBudget({ estimatedTokens: 101, contextLimit: 100 });
    if (!result.allowed) {
      expect(result.reason).toBe('over-budget');
    } else {
      throw new Error('expected the send to be blocked');
    }
  });

  test('I7 carries no reason on an allowed result', () => {
    const result = evaluateSendBudget({ estimatedTokens: 99, contextLimit: 100 });
    expect('reason' in result).toBe(false);
  });
});

describe('estimatePromptTokens', () => {
  test('I8 rounds up to the nearest four characters', () => {
    expect(estimatePromptTokens('abcd')).toBe(1);
    expect(estimatePromptTokens('abcde')).toBe(2);
  });

  test('I9 returns zero for an empty string', () => {
    expect(estimatePromptTokens('')).toBe(0);
  });

  test('I10 returns a non-negative integer for a sample string', () => {
    const result = estimatePromptTokens('a reasonably sized prompt that is not empty');
    expect(result).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(result)).toBe(true);
  });

  test('I11 is deterministic for the same input', () => {
    const input = 'the same prompt text measured twice';
    expect(estimatePromptTokens(input)).toBe(estimatePromptTokens(input));
  });
});

describe('DEFAULT_CONTEXT_LIMIT', () => {
  test('I12 is 200_000', () => {
    expect(DEFAULT_CONTEXT_LIMIT).toBe(200_000);
  });
});

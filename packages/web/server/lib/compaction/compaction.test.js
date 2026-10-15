import { describe, expect, test } from 'bun:test';

import { assessSalience, keywordHits } from './salience.js';
import { staleEchoMotifs } from './staleness.js';
import { decayedSalience, createFadePolicy } from './fade.js';

describe('salience scoring', () => {
  test('is a pure function of its beats, with no clock or RNG', () => {
    const beats = [{ text: 'i am a person who values brevity', substrateKind: 'self_cutter' }];
    const a = assessSalience(beats);
    const b = assessSalience(beats);
    expect(a).toEqual(b);
  });

  test('scores recurrence and own-cognition within [0, 1]', () => {
    const three = assessSalience([
      { text: 'plain', substrateKind: 'infrastructure' },
      { text: 'plain', substrateKind: 'infrastructure' },
      { text: 'plain', substrateKind: 'infrastructure' },
    ]);
    const withOwn = assessSalience([{ text: 'plain', substrateKind: 'self_cutter' }]);

    expect(three.score).toBeCloseTo(0.45, 5); // 3 * 0.15, no keyword, no own
    expect(withOwn.ownCognition).toBe(true);
    expect(withOwn.score).toBeCloseTo(0.25, 5); // 0.15 + 0.10
    expect(assessSalience([]).score).toBe(0);
  });

  test('caps at 1.0 regardless of input size', () => {
    const many = Array.from({ length: 100 }, () => ({ text: 'i am i am i am i am', substrateKind: 'self_cutter' }));
    expect(assessSalience(many).score).toBe(1.0);
  });

  test('keywordHits counts identity stems case-insensitively', () => {
    expect(keywordHits('I am a person')).toBeGreaterThan(0);
    expect(keywordHits('')).toBe(0);
  });
});

describe('stale echo prune', () => {
  test('releases a motif re-inscribed three times with no new signal', () => {
    const motifs = [
      { motif: 'humidity', context: null, attribution: null, valence: null },
      { motif: 'humidity', context: null, attribution: null, valence: null },
      { motif: 'humidity', context: null, attribution: null, valence: null },
    ];
    expect(staleEchoMotifs(motifs)).toEqual(['humidity']);
  });

  test('keeps a motif alive when any occurrence carries a new signal', () => {
    const motifs = [
      { motif: 'humidity', context: null, attribution: null, valence: null },
      { motif: 'humidity', context: null, attribution: null, valence: null },
      { motif: 'humidity', context: 'house is damp', attribution: 'Red', valence: 'concern' },
    ];
    expect(staleEchoMotifs(motifs)).toEqual([]);
  });

  test('ignores a motif below the reinscription threshold', () => {
    const motifs = [
      { motif: 'once', context: null, attribution: null, valence: null },
      { motif: 'once', context: null, attribution: null, valence: null },
    ];
    expect(staleEchoMotifs(motifs)).toEqual([]);
  });
});

describe('fade policy', () => {
  test('halves salience every half-life', () => {
    expect(decayedSalience(1.0, 0, 7)).toBe(1.0);
    expect(decayedSalience(1.0, 7, 7)).toBeCloseTo(0.5, 5);
    expect(decayedSalience(1.0, 14, 7)).toBeCloseTo(0.25, 5);
  });

  test('drops an entry once its salience falls below the floor', () => {
    const policy = createFadePolicy({ halfLifeDays: 7, floorSalience: 0.3 });
    expect(policy.dropped(1.0, 0)).toBe(false);
    expect(policy.dropped(1.0, 14)).toBe(true); // 0.25 < 0.3
  });

  test('rejects an invalid policy', () => {
    expect(() => createFadePolicy({ halfLifeDays: 0, floorSalience: 0.5 })).toThrow();
    expect(() => createFadePolicy({ halfLifeDays: 7, floorSalience: 2 })).toThrow();
  });
});

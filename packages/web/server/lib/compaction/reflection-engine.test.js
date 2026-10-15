import { describe, expect, test } from 'bun:test';
import { createReflectionEngine } from './reflection-engine.js';

describe('Reflection & Dream Engine (OODA Loops 2 & 3)', () => {
  const createMockEpisodicLog = () => {
    const events = [];
    let seq = 0;
    return {
      append: async (event) => {
        seq += 1;
        const entry = { seq, ...event };
        events.push(entry);
        return true;
      },
      tail: async (limit) => events.slice(-limit),
      getEvents: () => events,
    };
  };

  test('respects activity threshold and cooldown', async () => {
    let clock = 1000;
    const log = createMockEpisodicLog();
    const engine = createReflectionEngine({
      episodicLog: log,
      reflectionThreshold: 2,
      reflectionCooldownMs: 5000,
      now: () => clock,
    });

    // 0 events -> threshold unmet
    const r1 = await engine.reflect();
    expect(r1.triggered).toBe(false);
    expect(r1.reason).toBe('threshold_unmet');

    // Add 2 events
    await log.append({ kind: 'session.text.delta', source_provenance: { substrate_kind: 'session_event' }, payload: { text: 'hello' } });
    await log.append({ kind: 'session.text.delta', source_provenance: { substrate_kind: 'session_event' }, payload: { text: 'world' } });

    // Should trigger reflection
    const r2 = await engine.reflect();
    expect(r2.triggered).toBe(true);
    expect(r2.reflection.eventsProcessed).toBe(2);

    // Immediately calling reflect again -> cooldown active
    const r3 = await engine.reflect();
    expect(r3.triggered).toBe(false);
    expect(r3.reason).toBe('cooldown_active');

    // Advance clock past cooldown but no new events -> threshold unmet
    clock += 6000;
    const r4 = await engine.reflect();
    expect(r4.triggered).toBe(false);
    expect(r4.reason).toBe('threshold_unmet');
  });

  test('scores salience and detects stale echo motifs', async () => {
    const log = createMockEpisodicLog();
    const engine = createReflectionEngine({
      episodicLog: log,
      reflectionThreshold: 3,
      now: () => 1000,
    });

    // Inscribe repeated motif 3 times with identical context
    await log.append({ kind: 'turn', source_provenance: { substrate_kind: 'agent' }, payload: { summary: 'stale motif text' } });
    await log.append({ kind: 'turn', source_provenance: { substrate_kind: 'agent' }, payload: { summary: 'stale motif text' } });
    await log.append({ kind: 'turn', source_provenance: { substrate_kind: 'agent' }, payload: { summary: 'stale motif text' } });

    const r = await engine.reflect({ force: true });
    expect(r.triggered).toBe(true);
    expect(r.reflection.staleMotifs).toContain('stale motif text');
  });

  test('triggers dream cycle when reflection threshold is reached', async () => {
    let clock = 1000;
    const log = createMockEpisodicLog();
    const engine = createReflectionEngine({
      episodicLog: log,
      reflectionThreshold: 1,
      reflectionCooldownMs: 100,
      dreamThreshold: 3,
      now: () => clock,
    });

    for (let i = 0; i < 3; i += 1) {
      await log.append({ kind: 'turn', source_provenance: { substrate_kind: 'agent' }, payload: { summary: `event ${i}` } });
      clock += 200;
      await engine.reflect();
    }

    const events = log.getEvents();
    const reflections = events.filter((e) => e.kind === 'memory.reflection');
    const dreams = events.filter((e) => e.kind === 'memory.dream');

    expect(reflections.length).toBe(3);
    expect(dreams.length).toBe(1);
    expect(dreams[0].source_provenance.substrate_kind).toBe('dream_cycle');
    expect(dreams[0].payload.reflectionsSynthesized).toBe(3);
  });
});

/**
 * Autonomous Reflection & Dream Engine (OODA Loops 2 & 3).
 *
 * Implements Cutter's provoked reflection pass and slow dream synthesis cycle
 * for OpenChamber, grounded in the rules from MEMORY_ARCHITECTURE_REPORT.md:
 *
 *   - Loop 1: Heart tick / River (episodic log) records raw events as they land.
 *   - Loop 2: Reflection pass (provoked when activity settles, cooldown floor).
 *             Evaluates salience and staleness, writes 'memory.reflection' to the River.
 *   - Loop 3: Dream cycle (pattern recognition across accumulated reflections).
 *             Synthesizes multi-session themes, writes 'memory.dream' to the River.
 *
 * [DECISION_RECORD] Reflection is provoked by activity deltas, not a metronome.
 *   Stillness is the default when no new events have arrived.
 * [DECISION_RECORD] Strict provenance is enforced: reflection writes use
 *   'reflection_pass' substrate, dream writes use 'dream_cycle' substrate.
 */

import { assessSalience } from './salience.js';
import { staleEchoMotifs } from './staleness.js';

export const createReflectionEngine = ({
  episodicLog,
  vaultPromotion = null,
  reflectionThreshold = 3, // min new events to provoke reflection
  reflectionCooldownMs = 60_000, // 1 minute cooldown between reflections
  dreamThreshold = 3, // min un-dreamed reflections to trigger dream cycle
  now = () => Date.now(),
  logger = () => {},
}) => {
  if (!episodicLog) throw new Error('episodicLog is required');

  let lastReflectionAt = 0;
  let lastProcessedSeq = 0;
  let reflectionTimer = null;
  let running = false;

  /**
   * Evaluates recent events and produces a reflection if delta threshold and
   * cooldown requirements are met.
   */
  const reflect = async ({ force = false } = {}) => {
    const currentTime = typeof now === 'function' ? now() : Date.now();
    const timeSinceLast = lastReflectionAt === 0 ? Infinity : currentTime - lastReflectionAt;

    if (!force && timeSinceLast < reflectionCooldownMs) {
      return { triggered: false, reason: 'cooldown_active', waitMs: reflectionCooldownMs - timeSinceLast };
    }

    // Read recent tail of the River
    const recentEvents = await episodicLog.tail(100);
    const newEvents = recentEvents.filter((e) => Number.isInteger(e.seq) && e.seq > lastProcessedSeq);

    if (!force && newEvents.length < reflectionThreshold) {
      return { triggered: false, reason: 'threshold_unmet', newEventCount: newEvents.length };
    }

    // Extract beats from events for salience evaluation
    const beats = newEvents
      .filter((e) => e.kind !== 'memory.reflection' && e.kind !== 'memory.dream')
      .map((e) => ({
        text: e.payload?.summary || e.payload?.text || e.kind || '',
        substrateKind: e.source_provenance?.substrate_kind || 'session_event',
      }))
      .filter((b) => b.text.trim().length > 0);

    const salience = assessSalience(beats);

    // Stale echo analysis over observed event motifs
    const inscriptions = beats.map((b) => ({
      motif: b.text.slice(0, 80),
      context: b.substrateKind,
      attribution: 'openchamber',
      valence: 'neutral',
    }));
    const stale = staleEchoMotifs(inscriptions, { minReinscriptions: 3 });

    // Update watermark
    const highestSeq = newEvents.reduce((max, e) => Math.max(max, e.seq || 0), lastProcessedSeq);
    lastProcessedSeq = highestSeq;
    lastReflectionAt = currentTime;

    const reflectionPayload = {
      salienceScore: salience.score,
      recurrence: salience.recurrence,
      keywordHits: salience.keywordHits,
      ownCognition: salience.ownCognition,
      eventsProcessed: newEvents.length,
      staleMotifs: stale,
      admitted: salience.score >= 0.40,
      timestamp: new Date(currentTime).toISOString(),
    };

    // Write reflection back into the River with strict provenance
    await episodicLog.append({
      kind: 'memory.reflection',
      source_provenance: { substrate_kind: 'reflection_pass' },
      payload: reflectionPayload,
    });

    logger('reflection completed', reflectionPayload);

    // Check if dream threshold is reached
    const dreamResult = await maybeDream({ force: false });

    return {
      triggered: true,
      reflection: reflectionPayload,
      dream: dreamResult,
    };
  };

  /**
   * Evaluates accumulated reflections and synthesizes high-order patterns
   * when threshold is reached.
   */
  const maybeDream = async ({ force = false } = {}) => {
    const recent = await episodicLog.tail(50);
    const reflections = recent.filter((e) => e.kind === 'memory.reflection');
    const lastDream = recent.reverse().find((e) => e.kind === 'memory.dream');
    const lastDreamSeq = lastDream?.seq || 0;

    const unDreamedReflections = reflections.filter((r) => r.seq > lastDreamSeq);

    if (!force && unDreamedReflections.length < dreamThreshold) {
      return { triggered: false, reason: 'dream_threshold_unmet', unDreamedCount: unDreamedReflections.length };
    }

    const currentTime = typeof now === 'function' ? now() : Date.now();

    // High-order synthesis across un-dreamed reflections
    const themes = [];
    let highSalienceCount = 0;

    for (const r of unDreamedReflections) {
      const p = r.payload || {};
      if (p.salienceScore >= 0.40) highSalienceCount += 1;
      if (p.staleMotifs?.length > 0) {
        themes.push(`stale_echoes_pruned: ${p.staleMotifs.length}`);
      }
    }

    const dreamPayload = {
      reflectionsSynthesized: unDreamedReflections.length,
      highSalienceRatio: unDreamedReflections.length > 0 ? highSalienceCount / unDreamedReflections.length : 0,
      synthesis: `Synthesized ${unDreamedReflections.length} reflection passes. High salience ratio: ${
        unDreamedReflections.length > 0 ? (highSalienceCount / unDreamedReflections.length).toFixed(2) : '0'
      }.`,
      themes,
      timestamp: new Date(currentTime).toISOString(),
    };

    await episodicLog.append({
      kind: 'memory.dream',
      source_provenance: { substrate_kind: 'dream_cycle' },
      payload: dreamPayload,
    });

    logger('dream cycle completed', dreamPayload);

    return {
      triggered: true,
      dream: dreamPayload,
    };
  };

  /**
   * Starts autonomous periodic inspection.
   */
  const start = (pollIntervalMs = 60_000) => {
    if (running) return;
    running = true;
    reflectionTimer = setInterval(() => {
      void reflect({ force: false }).catch((err) => {
        logger('background reflection error', err);
      });
    }, pollIntervalMs);
  };

  const stop = () => {
    running = false;
    if (reflectionTimer) {
      clearInterval(reflectionTimer);
      reflectionTimer = null;
    }
  };

  return {
    reflect,
    maybeDream,
    start,
    stop,
    status: () => ({
      running,
      lastReflectionAt,
      lastProcessedSeq,
    }),
  };
};

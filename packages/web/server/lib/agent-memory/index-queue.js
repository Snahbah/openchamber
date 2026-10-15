/**
 * Index-on-write queue.
 *
 * Chains the vault-promotion bridge and the vault-index sync off the hot write
 * path. The `memory.json` write is synchronous and authoritative — it must
 * succeed or the memory is not stored. This queue is the non-blocking tail that
 * mirrors each entry into the semantic index, so the prompt block can rank by
 * relevance instead of reading the flat title list.
 *
 * NOT fire-and-forget. A fire-and-forget `promote().catch()` would drop a failed
 * index write silently and forever, leaving the memory store and the semantic
 * index to drift apart. This is a bounded queue with a background drain, per-job
 * retry with exponential backoff, and counters (`pending` / `dropped` /
 * `errors` / `processed` / `retried`) so a full or failing queue is visible in
 * stats rather than silent.
 *
 * The enqueue path never awaits the index work: `enqueue` pushes and returns, and
 * the drain runs on its own ticks. The write path therefore stays non-blocking,
 * and a slow or down vault-index can only ever slow the mirror, never the save.
 */

export const createIndexQueue = ({
  promote,
  syncFile,
  maxPending = 200,
  maxAttempts = 3,
  baseBackoffMs = 1000,
  maxBackoffMs = 30_000,
  logger = null,
}) => {
  if (typeof promote !== 'function') throw new Error('promote is required');
  if (typeof syncFile !== 'function') throw new Error('syncFile is required');

  const queue = [];
  let draining = false;
  let stopped = false;
  let wakeTimer = null;

  const counters = { dropped: 0, errors: 0, processed: 0, retried: 0 };

  const log = (level, message, payload) => {
    try {
      if (logger && typeof logger[level] === 'function') logger[level](message, payload);
      else if (typeof logger === 'function') logger(message, payload);
    } catch {
      // A log write must never throw into the drain.
    }
  };

  /**
   * Process the queue FIFO. On a failed job, retry with exponential backoff
   * WITHOUT holding the drain — the failed job re-enters on a timer, so a single
   * poison job cannot wedge the jobs already waiting behind it.
   */
  const drain = async () => {
    if (draining || stopped) return;
    draining = true;
    try {
      while (!stopped && queue.length > 0) {
        const job = queue.shift();
        try {
          const notePath = await promote(job.entry, job.scope);
          await syncFile(notePath);
          counters.processed += 1;
        } catch (error) {
          job.attempts += 1;
          if (job.attempts <= maxAttempts) {
            counters.retried += 1;
            const delay = Math.min(baseBackoffMs * 2 ** (job.attempts - 1), maxBackoffMs);
            wakeTimer = setTimeout(() => {
              wakeTimer = null;
              if (!stopped) {
                queue.push(job);
                void drain();
              }
            }, delay);
            wakeTimer.unref?.();
            continue;
          }
          counters.errors += 1;
          log('warn', 'memory.index.failed', {
            id: job.entry?.id,
            scope: job.scope,
            attempts: job.attempts,
            reason: error?.message || String(error),
          });
        }
      }
    } finally {
      draining = false;
      // A retry re-queued while this pass was ending still needs draining.
      if (!stopped && queue.length > 0) void drain();
    }
  };

  /**
   * Queue an entry for mirroring. Synchronous and never throws. Flagged entries
   * are skipped outright — they are held back from sessions anyway, so indexing
   * them would only add injection-shaped text to the semantic store.
   */
  const enqueue = (entry, scope) => {
    if (stopped) {
      counters.dropped += 1;
      return;
    }
    if (entry && entry.flagged) return;
    if (queue.length >= maxPending) {
      counters.dropped += 1;
      return;
    }
    queue.push({ entry, scope, attempts: 0 });
    if (!draining) void drain();
  };

  const stats = () => ({ ...counters, pending: queue.length });

  const stop = () => {
    stopped = true;
    if (wakeTimer) clearTimeout(wakeTimer);
    wakeTimer = null;
    queue.length = 0;
  };

  return { enqueue, stats, stop };
};

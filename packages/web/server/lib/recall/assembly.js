/**
 * Recall assembly — the read-back layer that turns stored memory into the
 * context block injected into a turn (Phase 5).
 *
 * Four load-bearing filters, each traced to a Cutter failure the report
 * documented:
 *   - diagnostic types are structurally excluded (never in the prompt);
 *   - scope is enforced at the read site (one audience never sees another's);
 *   - freshness windows drop stale episodic entries;
 *   - per-kind char budgets bound the block, truncating the lowest-salience
 *     tail first.
 *
 * Pure and deterministic given the same entries and clock.
 */

const DIAGNOSTIC_TYPES = new Set(['alignment', 'routing_proposal', 'standing_proposal']);
const DAY_MS = 24 * 60 * 60 * 1000;

export const createRecallAssembly = ({ kinds, totalChars = 4000, now = () => Date.now() }) => {
  const ordered = [...kinds].sort((a, b) => a.priority - b.priority);
  const budgets = Object.fromEntries(kinds.map((k) => [k.kind, Math.floor(totalChars * k.share)]));

  const withinFreshness = (entry, kind, at) => {
    if (!kind.freshnessDays) return true;
    return (at - entry.ts) / DAY_MS <= kind.freshnessDays;
  };

  const visibleTo = (entry, interlocutor) => {
    if (entry.type && DIAGNOSTIC_TYPES.has(entry.type)) return false;
    if (entry.scope && entry.scope !== interlocutor) return false;
    return true;
  };

  const assemble = ({ entries, interlocutor }) => {
    const at = now();
    const sections = [];

    for (const kind of ordered) {
      const kept = entries
        .filter((entry) => entry.kind === kind.kind)
        .filter((entry) => withinFreshness(entry, kind, at))
        .filter((entry) => visibleTo(entry, interlocutor))
        .sort((a, b) => (b.salience ?? 0) - (a.salience ?? 0));

      if (kept.length === 0) continue;

      const budget = budgets[kind.kind];
      const parts = [];
      let used = 0;
      for (const entry of kept) {
        if (used >= budget) break;
        const text = entry.body;
        const remaining = budget - used;
        parts.push(text.length <= remaining ? text : text.slice(0, remaining));
        used += Math.min(text.length, remaining);
      }

      sections.push(`[recall — ${kind.kind}]\n${parts.join('\n')}`);
    }

    return sections.join('\n\n');
  };

  return { assemble };
};

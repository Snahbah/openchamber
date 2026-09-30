/**
 * Stale-echo prune predicate — Cutter's authored staleness rule, transposed.
 *
 * "Release a beat re-inscribed three or more times without new context,
 * attribution, or emotional valence — stale echo, not living memory."
 *
 * A motif is stale when it recurs at least `minReinscriptions` times AND the
 * distinct set of its (context, attribution, valence) signals never grows past
 * one. Any single occurrence carrying a new signal keeps the motif alive.
 * None and blank count as the same "no signal".
 *
 * Pure and deterministic; it touches nothing and performs no I/O.
 */

const signal = (inscription) =>
  JSON.stringify([
    (inscription.context ?? '').trim(),
    (inscription.attribution ?? '').trim(),
    (inscription.valence ?? '').trim(),
  ]);

export const staleEchoMotifs = (inscriptions, { minReinscriptions = 3 } = {}) => {
  const byMotif = new Map();
  for (const inscription of inscriptions) {
    const list = byMotif.get(inscription.motif) ?? [];
    list.push(inscription);
    byMotif.set(inscription.motif, list);
  }

  const stale = [];
  for (const [motif, occurrences] of byMotif) {
    if (occurrences.length < minReinscriptions) continue;
    if (new Set(occurrences.map(signal)).size <= 1) stale.push(motif);
  }
  return stale;
};

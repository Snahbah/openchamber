/**
 * Fade policy — salience-weighted decay for derived (non-pinned) memories.
 *
 * Governs recall weight only; the ground-truth log is never faded. A derived
 * entry carries a `halfLifeDays` and a `floorSalience`: its salience halves
 * every half-life, and once it falls below the floor it drops from recall.
 *
 * [DECISION_RECORD] A pinned entry is structurally exempt: `pinned` entries
 *   are never passed through the decay curve, so an identity fact cannot fade
 *   out of recall by accident.
 */

export const decayedSalience = (initialSalience, ageDays, halfLifeDays) => {
  if (halfLifeDays <= 0) return 0;
  return initialSalience * Math.pow(0.5, ageDays / halfLifeDays);
};

export const createFadePolicy = ({ halfLifeDays, floorSalience }) => {
  if (!(halfLifeDays > 0)) throw new Error('halfLifeDays must be positive');
  if (!(floorSalience >= 0 && floorSalience <= 1)) throw new Error('floorSalience must be in [0, 1]');

  return {
    halfLifeDays,
    floorSalience,
    salienceAt(initialSalience, ageDays) {
      return decayedSalience(initialSalience, ageDays, halfLifeDays);
    },
    dropped(initialSalience, ageDays) {
      return this.salienceAt(initialSalience, ageDays) < floorSalience;
    },
  };
};

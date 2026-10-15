/**
 * Deterministic salience scoring — the rules_stub heuristic transposed to
 * OpenChamber (Tier 2 → Tier 3 promotion gate).
 *
 * No RNG, no clock. `assessSalience` is a pure function of its beats, so two
 * passes over the same slice produce byte-identical scores.
 *
 * Weights match Cutter's `rules_stub`: recurrence up to 0.50, identity-keyword
 * hits up to 0.40, an own-cognition bonus of 0.10, capped at 1.0.
 */

export const IDENTITY_KEYWORDS = [
  'i am', 'who i am', 'my name', 'myself', 'i value', 'i believe',
  'matters to me', 'i promise', 'i commit', 'always', 'never', 'becoming',
];

const RECURRENCE_STEP = 0.15;
const RECURRENCE_CAP = 0.50;
const KEYWORD_STEP = 0.10;
const KEYWORD_CAP = 0.40;
const OWN_COGNITION_BONUS = 0.10;

export const keywordHits = (text) => {
  const low = String(text).toLowerCase();
  return IDENTITY_KEYWORDS.reduce((acc, keyword) => (low.includes(keyword) ? acc + 1 : acc), 0);
};

/**
 * Score a candidate from the beats that corroborate it. Each beat is
 * `{ text, substrateKind }`; own-cognition is a beat whose `substrateKind`
 * is `self_cutter` (the agent's own thought, not infrastructure water).
 */
export const assessSalience = (beats) => {
  const texts = beats.map((beat) => (beat && beat.text) || '');
  const recurrence = Math.min(RECURRENCE_CAP, RECURRENCE_STEP * beats.length);
  const hits = texts.reduce((acc, text) => acc + keywordHits(text), 0);
  const keyword = Math.min(KEYWORD_CAP, KEYWORD_STEP * hits);
  const ownCognition = beats.some((beat) => beat && beat.substrateKind === 'self_cutter');
  const score = Math.min(1.0, recurrence + keyword + (ownCognition ? OWN_COGNITION_BONUS : 0));

  return { score, recurrence: beats.length, keywordHits: hits, ownCognition };
};

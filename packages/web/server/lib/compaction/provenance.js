/**
 * Poison-defence provenance gate (Phase 6).
 *
 * A pin is the only way a memory becomes exempt from fade, so the gate's one
 * job is to make sure a low-trust source can never pin, and that a "victory"
 * (an agent's claim about its own identity) cannot self-promote without an
 * explicit grant. A poisoned or off-voice fact therefore can at worst be
 * admitted as a fadeable entry, never enshrined as identity.
 *
 * [DECISION_RECORD] An unattributed event fails closed: with no provenance it
 *   is treated as low trust, so it cannot pin.
 */

const LOW_TRUST_KINDS = new Set(['sub_agent', 'external', 'web']);

export const classifyTrust = (provenance) => {
  const kind = provenance && provenance.substrate_kind;
  if (typeof kind !== 'string' || !kind.trim()) return 'low'; // fail closed
  if (LOW_TRUST_KINDS.has(kind)) return 'low';
  return 'high';
};

export const canPin = ({ trust, pinBasis, granted = false }) => {
  if (trust !== 'high') return false;
  if (pinBasis === 'victory') return granted === true;
  return true; // identity-tier, high-trust
};

export const effectiveVerdict = ({ trust, requested }) => {
  if (requested === 'pin' && trust !== 'high') return 'admit';
  return requested;
};

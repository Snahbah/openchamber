# Delta closure — 2026-10-16

Closes the reconciliation port that made `reconcile/2.3.1-port` (off upstream
v2.3.1) carry the memory consolidation, the hardening, and the Qwen Cloud quota
work — and nothing else.

## A note on the branch's scope

`feat/memory-consolidation` was named as if it held one feature. It did not. It
is a long-running personal branch that forked from upstream `main` before 2.3.1
and accumulated several feature lineages over months. Every "small port"
estimate in this pass was wrong because the *name* was wrong: the branch lied
about its own scope. This port is therefore a **merge of two divergent lines**,
not a linear replay of one feature. The delta kept growing because the branch
kept turning out to be bigger than its name.

## What was ported

- **Hardening** (4 files): session-goal budget/compaction/kill-switch, routing
  quota-refuse + fallback telemetry, index.js kill-switch route + fallback
  counter.
- **Memory consolidation** (18 files): index-on-write queue, session-learning
  mirror, vault promotion, idle detector, session-knowledge vault read,
  agent-memory enqueue — plus the drifted 18th file, `agent-memory/actions.js`
  (memory.promote/query/guardrails/preflight) and the `threat-patterns.js`
  drift.
- **Sovereign-memory layers**: vault-index read path (LanceDB), estate-knowledge
  engine, recall assembly, compaction loops, episodic log.
- **The `index.js` memory-subsystem wiring** (imports → runtime setup →
  queryMemory → routes), activating all of the above.
- **Quota/usage**: server `qwencloud` provider (`alibaba-token-plan`) + the
  vscode `qwencloudQuota.ts` surface.
- **Docs**: `DEPLOYMENT.md`, `PROVIDER-POLICY.md`, `night-2026-10-15.md`.

## Divergent features, deliberately not ported

The branch `feat/memory-consolidation` forked from upstream main before 2.3.1
and accumulated features 2.3.1 never received: Magic Prompts, Skills Catalog,
Remote Instances, External Tunnel, Prompt Templates, `openCodeGo.authCookie`.
These are **not** part of the memory consolidation, the hardening, or the
quota work. They remain on the branch for a future deliberate port if wanted.
They are not carried forward in this pass because their scope is unknown and
porting them would grow the fork when the goal is to shrink it.

## What remains

Phase E (test the branch — full suite + four behavioural checks) → Phase F
(link, marker test) → Phase G (push, mark `DEPLOYMENT.md` "repo is source of
truth"). The repo is now feature-complete for the memory consolidation, the
hardening, and the quota work; the install is still untouched (patch-library
model, not yet npm-linked).

# Consolidation port blocked: index.js — DEFERRED

**Date:** 2026-10-16
**Decision:** Deferred (Option 2). The memory-subsystem wiring in `index.js` is not ported.

## What is ported and committed

52 files across 9 commits on `reconcile/2.3.1-port`:

- **Hardening** — session-goal budget/compaction/audit/kill-switch; routing quota-refuse + fallback telemetry; index.js kill-switch route + fallback counter.
- **Memory consolidation** — 17 of 18 files (session-knowledge vault read, agent-memory index-queue, the 9 new modules).
- **Sovereign-memory layers** — vault-index read path, estate-knowledge engine, recall, compaction, episodic-log (32 files), plus the `@lancedb/lancedb` + `onnxruntime-web` deps.

All `node --check` clean. The consolidation is **inert and safe**: `queryMemory` defaults to null and `indexQueue?.enqueue` no-ops when undefined, so the system behaves exactly like the flat index it replaces. Nothing boots differently.

## What is blocked

`packages/web/server/index.js` — the wiring that activates the above. It grew from the assumed "+77" to **~160–200 lines of delicate by-hand wiring**: the base memory-subsystem setup (vault-promotion, vault-index, estate, episodic-log, reflection-engine), the consolidation's indexQueue/backfill/mirror/queryMemory, and the vault/estate routes. It introduces two new path variables (`agentsVaultArtifactsDir`, `agentsVaultRoot`) and references the estate engine — which Section 12 marks "does not close".

**Failure mode:** a wrong path or a missed route breaks the server at boot. Deliberate work for a clear head and a rollback plan, not the tail of a long session.

## Next step

One tightly-scoped prompt: pre-extract the base-wiring line ranges (imports, vault path vars, runtime setup, routes, queryMemory, control-service/feature-routes wiring) from `feat/memory-consolidation`, hand them to a capable model once for synthesis onto 2.3.1's `index.js` — not an open-ended "go port this".

## State

The install is untouched (no `npm link` yet; the running server is unaffected). The 52 committed files are the durable record.

# Estate Knowledge — the one door for OpenChamber memory and reference LanceDBs

## What this is

OpenChamber memory is **one door, in-process, not MCP**. The `openchamber_memory`
agent tool is the only way an agent reaches memory, and behind that tool sits a
single in-process LanceDB engine (`estate-knowledge.js`) that serves every
knowledge domain. There is no per-domain MCP server.

Two things are routinely confused and must stay distinct:

- **`openchamber_memory`** (native agent tool) — the door. Registered by the
  OpenChamber server's managed plugin, gated by `OPENCHAMBER_MEMORY_ENABLE` and
  the `agentMemoryToolEnabled` setting.
- **`chromadb-memory`** (remote HTTP MCP, `89.167.90.172:9591`) — the Smugglers
  diary. Unrelated to OpenChamber memory. Not the door, and not a reason to keep
  or drop the door.

## The one door

```
openchamber_memory tool  ──►  estate-knowledge.js (in-process LanceDB)
                                 ├── vault        memory + Obsidian vault notes
                                 ├── typescript   Waves 2 reference
                                 ├── adobe        ActionDescriptors
                                 └── maxon        C4D / Maxon reference (maxon_core)
```

`estate-knowledge.js` consolidates all four LanceDB datasets and runs zero
external daemons. A reference LanceDB is added here as a new **domain** — never
as a standalone MCP server. The `memory.query` action reaches any domain via its
`domain` parameter (`vault`, `typescript`, `adobe`, `maxon`, `all`); default is
`vault`.

Reference LanceDBs live under `~/Documents/GitHub/Lance Databases/`:
`typescript_reference.lance`, `adobe_codex.lance`, `maxon_lancedb.lance`. The
vault lives in `<data-dir>/stores/vault`. Paths are wired once in
`server/index.js` (`createEstateKnowledgeEngine`).

## The tiers and loops

Memory is not one store; it is three tiers with three loops behind the same door:

1. **Episodic event log** (loop 1) — append-only, Lamport-sequenced JSONL.
2. **Vault semantic index** — the Agents Vault embedded into a local LanceDB
   table; `vaultPromotionRuntime` promotes memory entries into
   `Agents Vault/Artifacts` (the artefacts).
3. **Reflection & Dream engine** (loops 2 and 3) — autonomous background
   reflection over the episodic log, and promotion to the vault.

Compaction reads the same memory store (`session-knowledge/`), so memory state
interacts with compaction degradation — the reason memory must never be assumed
off just because a session was compacted.

## The rule, stated

Reference LanceDBs are served **through this door**. Do not stand up a separate
MCP server for `adobe`, `typescript`, or `maxon` knowledge; add a domain to
`estate-knowledge.js` instead. The live tool-driving MCPs (`cinema4d`,
`photoshop`, `illustrator`, `indesign`, `google-workspace`, `open-design`,
`hivemind`) are unrelated to this door and stay in the global `opencode.json`.

Memory is **not a model's to turn off**. A model that "knows better" may not
disable the `openchamber_memory` tool, flip `agentMemoryToolEnabled`, clear
`OPENCHAMBER_MEMORY_ENABLE`, or cull these MCPs unilaterally — they are the
user's decision. Removing the door to "fix" a process count or tidy a config is
an error, not an optimization.

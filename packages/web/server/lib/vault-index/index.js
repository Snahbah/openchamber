/**
 * Vault index — evict-before-upsert mirroring of vault Markdown into a
 * pluggable semantic store (Tier 2).
 *
 * The store is injected so the same engine drives a real ChromaDB adapter or
 * an in-memory store in tests. The store's contract is narrow:
 *
 *   - `upsert({ ids, documents, metadatas })`
 *   - `idsWhere({ source_path }) -> string[]`
 *   - `delete(ids)`
 *
 * [DECISION_RECORD] Chunks are keyed deterministically by (vault-relative
 *   path, index, content), so a re-index of an unchanged file produces
 *   byte-identical ids and evict-before-upsert never leaves a stale chunk.
 * [DECISION_RECORD] Metadata carries the vault-relative path, never an
 *   absolute path, so the index does not leak the host's filesystem layout.
 */

import { parseFile, chunkIdFor } from './parser.js';

export const createVaultIndex = ({ store, parse = parseFile, chunkId = chunkIdFor }) => {
  const evictFile = async (relativePath) => {
    const ids = await store.idsWhere({ source_path: relativePath });
    if (ids.length > 0) await store.delete(ids);
    return ids.length;
  };

  const syncFile = async (relativePath, text) => {
    await evictFile(relativePath);

    const { metadata, chunks } = parse(text, { relativePath });
    if (chunks.length === 0) {
      return { indexed: 0, relativePath };
    }

    const ids = [];
    const documents = [];
    const metadatas = [];
    chunks.forEach((chunk, index) => {
      ids.push(chunkId(relativePath, index, chunk));
      documents.push(chunk);
      metadatas.push({
        source_path: relativePath,
        chunk_index: index,
        total_chunks: chunks.length,
        ...metadata,
      });
    });

    await store.upsert({ ids, documents, metadatas });
    return { indexed: chunks.length, relativePath };
  };

  return { syncFile, evictFile };
};

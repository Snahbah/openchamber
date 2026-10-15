/**
 * LanceDB store adapter — the semantic store behind the vault index.
 *
 * Implements the store contract the index engine expects
 * (`upsert({ ids, documents, metadatas })`, `idsWhere({ source_path })`,
 * `delete(ids)`) over an injected `db` (a LanceDB connection) and an injected
 * `embed` (documents -> vectors).
 *
 * [DECISION_RECORD] The adapter is embedder-agnostic: it only requires
 *   `embed(documents) -> number[][]`. Which runtime computes those vectors
 *   (onnxruntime-node, transformers.js, or an external embedder) is a wiring
 *   decision, not a store decision.
 *
 * Verified against `@lancedb/lancedb@0.39.0` by
 * `lance-store.integration.test.js`: `openTable`, `add`,
 * `query().where().select().toArray()`, and `delete(predicate)` match the real
 * API.
 */

import { toRows } from './row-shape.js';

const quote = (value) => String(value).replace(/'/g, "''");

export const createLanceStore = ({ db, tableName, embed }) => {
  if (!tableName) throw new Error('tableName is required');
  if (typeof embed !== 'function') throw new Error('embed is required');

  const open = () => db.openTable(tableName);

  const upsert = async ({ ids, documents, metadatas }) => {
    const vectors = await embed(documents);
    const rows = toRows({ ids, documents, metadatas, vectors });
    await (await open()).add(rows);
  };

  const idsWhere = async ({ source_path }) => {
    const table = await open();
    const results = await table
      .query()
      .where(`source_path = '${quote(source_path)}'`)
      .select(['id'])
      .toArray();
    return results.map((row) => row.id);
  };

  const removeByIds = async (ids) => {
    if (ids.length === 0) return;
    const quoted = ids.map((id) => `'${quote(id)}'`).join(', ');
    await (await open()).delete(`id IN (${quoted})`);
  };

  return { upsert, idsWhere, delete: removeByIds };
};

/**
 * Row shaping for the LanceDB store — the pure part of the adapter.
 *
 * Takes the vault index's upsert payload plus computed vectors and produces
 * the LanceDB rows: one per chunk, with the id, vector, searchable text, the
 * vault-relative source path, and the rest of the frontmatter folded into a
 * single metadata JSON column.
 *
 * [DECISION_RECORD] Metadata travels as one JSON string column so LanceDB's
 *   Arrow schema does not have to be re-declared for every frontmatter key
 *   the vault adds. `source_path` is lifted to its own column because it is
 *   the eviction key.
 */

export const toRows = ({ ids, documents, metadatas, vectors }) =>
  documents.map((document, index) => ({
    id: ids[index],
    vector: vectors[index],
    text: document,
    source_path: metadatas[index].source_path,
    metadata: JSON.stringify(metadatas[index]),
  }));

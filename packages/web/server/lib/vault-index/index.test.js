import { describe, expect, test } from 'bun:test';

import { createVaultIndex } from './index.js';

const createMemoryStore = () => {
  const rows = new Map(); // id -> { document, metadata }
  return {
    upsert: async ({ ids, documents, metadatas }) => {
      ids.forEach((id, i) => rows.set(id, { document: documents[i], metadata: metadatas[i] }));
    },
    idsWhere: async ({ source_path }) => (
      [...rows.entries()]
        .filter(([, row]) => row.metadata.source_path === source_path)
        .map(([id]) => id)
    ),
    delete: async (ids) => {
      ids.forEach((id) => rows.delete(id));
    },
    all: () => [...rows.entries()].map(([id, row]) => ({ id, ...row })),
  };
};

describe('vault index', () => {
  test('syncs a file into chunks with frontmatter folded into metadata', async () => {
    const store = createMemoryStore();
    const index = createVaultIndex({ store });
    const result = await index.syncFile('Notes/foo.md', '---\ntype: fact\n---\n\nSome body text.');
    expect(result.indexed).toBeGreaterThan(0);
    const rows = store.all();
    expect(rows[0].metadata.source_path).toBe('Notes/foo.md');
    expect(rows[0].metadata.type).toBe('fact');
  });

  test('evicts before upsert so a re-sync leaves no stale chunks', async () => {
    const store = createMemoryStore();
    const index = createVaultIndex({ store });
    await index.syncFile('Notes/foo.md', '---\ntype: fact\n---\n\nLong body text here that gets chunked.');

    await index.syncFile('Notes/foo.md', '---\ntype: fact\n---\n\nCompletely different body.');

    const rows = store.all();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.document !== 'Long body text here that gets chunked.')).toBe(true);
  });

  test('re-indexing an unchanged file produces identical ids', async () => {
    const note = '---\ntype: fact\n---\n\nStable body.';
    const firstStore = createMemoryStore();
    await createVaultIndex({ store: firstStore }).syncFile('Notes/foo.md', note);
    const first = firstStore.all().map((r) => r.id).sort();

    const secondStore = createMemoryStore();
    await createVaultIndex({ store: secondStore }).syncFile('Notes/foo.md', note);
    const second = secondStore.all().map((r) => r.id).sort();

    expect(first).toEqual(second);
  });

  test('indexes nothing for an empty body', async () => {
    const store = createMemoryStore();
    const index = createVaultIndex({ store });
    const result = await index.syncFile('Notes/empty.md', '---\ntype: fact\n---\n');
    expect(result.indexed).toBe(0);
    expect(store.all().length).toBe(0);
  });

  test('evictFile removes only the named file chunks', async () => {
    const store = createMemoryStore();
    const index = createVaultIndex({ store });
    await index.syncFile('Notes/a.md', '---\n---\n\nBody A.');
    await index.syncFile('Notes/b.md', '---\n---\n\nBody B.');

    await index.evictFile('Notes/a.md');
    const remaining = store.all();
    expect(remaining.every((r) => r.metadata.source_path === 'Notes/b.md')).toBe(true);
  });
});

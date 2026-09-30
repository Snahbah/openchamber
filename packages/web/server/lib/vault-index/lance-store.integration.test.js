import { describe, test, expect, beforeAll, afterAll } from 'bun:test';

import * as lancedb from '@lancedb/lancedb';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { createLanceStore } from './lance-store.js';

describe('lance-store (integration against real LanceDB)', () => {
  let dir;
  let db;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-lance-'));
    db = await lancedb.connect(dir);
    await db.createTable('vault', [
      { id: 'seed', vector: [0.0, 0.0], text: 'seed', source_path: 'seed', metadata: '{}' },
    ]);
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('round-trips upsert, filter, and delete through the store contract', async () => {
    const store = createLanceStore({
      db,
      tableName: 'vault',
      embed: async (docs) => docs.map(() => [1.0, 0.0]),
    });

    await store.upsert({
      ids: ['a_0', 'b_0'],
      documents: ['hello world', 'goodbye world'],
      metadatas: [
        { source_path: 'Notes/a.md', chunk_index: 0 },
        { source_path: 'Notes/b.md', chunk_index: 0 },
      ],
    });

    const idsA = await store.idsWhere({ source_path: 'Notes/a.md' });
    expect(idsA).toEqual(['a_0']);

    const idsB = await store.idsWhere({ source_path: 'Notes/b.md' });
    expect(idsB).toEqual(['b_0']);

    await store.delete(['a_0']);
    expect(await store.idsWhere({ source_path: 'Notes/a.md' })).toEqual([]);
    expect(await store.idsWhere({ source_path: 'Notes/b.md' })).toEqual(['b_0']);
  });
});

import { describe, expect, test } from 'bun:test';

import { toRows } from './row-shape.js';

describe('row shaping', () => {
  test('maps ids, documents, vectors, and metadata into LanceDB rows', () => {
    const rows = toRows({
      ids: ['Notes_a.md_0_abc123', 'Notes_b.md_0_def456'],
      documents: ['chunk A', 'chunk B'],
      metadatas: [
        { source_path: 'Notes/a.md', chunk_index: 0, type: 'fact' },
        { source_path: 'Notes/b.md', chunk_index: 0 },
      ],
      vectors: [[0.1, 0.2], [0.3, 0.4]],
    });

    expect(rows[0]).toEqual({
      id: 'Notes_a.md_0_abc123',
      vector: [0.1, 0.2],
      text: 'chunk A',
      source_path: 'Notes/a.md',
      metadata: JSON.stringify({ source_path: 'Notes/a.md', chunk_index: 0, type: 'fact' }),
    });
    expect(rows[1].source_path).toBe('Notes/b.md');
    expect(rows[1].vector).toEqual([0.3, 0.4]);
  });

  test('preserves one row per document in order', () => {
    const rows = toRows({
      ids: ['a', 'b', 'c'],
      documents: ['x', 'y', 'z'],
      metadatas: [{ source_path: 'p' }, { source_path: 'p' }, { source_path: 'p' }],
      vectors: [[1], [2], [3]],
    });
    expect(rows.map((r) => r.text)).toEqual(['x', 'y', 'z']);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});

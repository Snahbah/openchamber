import { describe, expect, test } from 'bun:test';

import { parseFile, chunkText, chunkIdFor } from './parser.js';

describe('vault parser', () => {
  test('parses frontmatter into flat metadata and strips it from the body', () => {
    const note = '---\ntype: fact\nscope: global\ntags: [session, memory]\n---\n\nBody text here.';
    const { metadata, chunks } = parseFile(note, { relativePath: 'Notes/foo.md' });
    expect(metadata.type).toBe('fact');
    expect(metadata.scope).toBe('global');
    expect(metadata.tags).toEqual(['session', 'memory']);
    expect(chunks[0]).toContain('Body text here.');
  });

  test('returns no frontmatter for a body with no fence', () => {
    const { metadata, chunks } = parseFile('Just body.', { relativePath: 'n.md' });
    expect(metadata).toEqual({});
    expect(chunks[0]).toBe('Just body.');
  });

  test('chunks a long body with overlap', () => {
    const text = 'a '.repeat(600); // 1200 chars
    const chunks = chunkText(text, { chunkSize: 500, chunkOverlap: 100 });
    expect(chunks.length).toBeGreaterThan(1);
  });

  test('returns an empty list for empty text', () => {
    expect(chunkText('')).toEqual([]);
  });

  test('generates deterministic, store-safe chunk ids', () => {
    const a = chunkIdFor('Notes/foo.md', 0, 'hello');
    const b = chunkIdFor('Notes/foo.md', 0, 'hello');
    const c = chunkIdFor('Notes/foo.md', 1, 'hello');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[a-zA-Z0-9._-]+$/);
  });
});

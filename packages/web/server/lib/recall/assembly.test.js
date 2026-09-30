import { describe, expect, test } from 'bun:test';

import { createRecallAssembly } from './assembly.js';

const KINDS = [
  { kind: 'memory', share: 0.4, freshnessDays: null, priority: 0 },
  { kind: 'episodic', share: 0.3, freshnessDays: 7, priority: 1 },
  { kind: 'artefact', share: 0.3, freshnessDays: null, priority: 2 },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE = Date.parse('2026-09-27T00:00:00Z');

const assembly = (overrides = {}) => createRecallAssembly({
  kinds: KINDS,
  totalChars: 4000,
  now: () => BASE,
  ...overrides,
});

const entry = (kind, body, overrides = {}) => ({ kind, body, ts: BASE, ...overrides });

describe('recall assembly', () => {
  test('renders visible entries in priority order with kind markers', () => {
    const result = assembly().assemble({
      entries: [
        entry('artefact', 'vault note'),
        entry('memory', 'typed fact'),
      ],
      interlocutor: 'red',
    });
    expect(result.indexOf('[recall — memory]')).toBeLessThan(result.indexOf('[recall — artefact]'));
    expect(result).toContain('typed fact');
    expect(result).toContain('vault note');
  });

  test('excludes a diagnostic type from the block', () => {
    const result = assembly().assemble({
      entries: [
        entry('memory', 'identity fact', { type: 'identity' }),
        entry('memory', 'self-eval', { type: 'alignment' }),
      ],
      interlocutor: 'red',
    });
    expect(result).toContain('identity fact');
    expect(result).not.toContain('self-eval');
  });

  test('never shows one audience a note scoped to another', () => {
    const result = assembly().assemble({
      entries: [
        entry('memory', 'shared', { scope: 'red' }),
        entry('memory', 'for emma', { scope: 'emma' }),
      ],
      interlocutor: 'red',
    });
    expect(result).toContain('shared');
    expect(result).not.toContain('for emma');
  });

  test('drops an episodic entry older than its freshness window', () => {
    const stale = BASE - 8 * DAY_MS;
    const fresh = BASE - 1 * DAY_MS;
    const result = assembly().assemble({
      entries: [
        entry('episodic', 'old thing', { ts: stale }),
        entry('episodic', 'recent thing', { ts: fresh }),
      ],
      interlocutor: 'red',
    });
    expect(result).not.toContain('old thing');
    expect(result).toContain('recent thing');
  });

  test('truncates a kind to its char budget', () => {
    const result = assembly({ totalChars: 100 }).assemble({
      entries: [entry('memory', 'x'.repeat(500))],
      interlocutor: 'red',
    });
    const memorySection = result.split('\n\n').find((s) => s.startsWith('[recall — memory]'));
    const body = memorySection.split('\n').slice(1).join('\n');
    // memory share = 0.4 of 100 = 40 chars
    expect(body.length).toBe(40);
  });

  test('renders nothing when no entry is visible', () => {
    expect(assembly().assemble({ entries: [], interlocutor: 'red' })).toBe('');
  });
});

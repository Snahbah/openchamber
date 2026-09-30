import { describe, expect, test } from 'bun:test';

import { createSyncCoordinator } from './sync-coordinator.js';

describe('sync coordinator', () => {
  test('debounces rapid events on one path into a single sync', async () => {
    let clock = 0;
    const synced = [];
    const coordinator = createSyncCoordinator({
      readFile: async (p) => `body of ${p}`,
      stat: async () => ({ mtimeNs: 1, size: 1 }),
      syncFile: async (p) => { synced.push(p); return { indexed: 1 }; },
      evictFile: async () => 0,
      debounceMs: 100,
      now: () => clock,
    });

    coordinator.handle('update', 'Notes/a.md');
    coordinator.handle('update', 'Notes/a.md');
    coordinator.handle('update', 'Notes/a.md');

    clock = 150;
    await coordinator.flush();

    expect(synced).toEqual(['Notes/a.md']);
  });

  test('skips a file whose mtime and size are unchanged', async () => {
    let clock = 0;
    const synced = [];
    const coordinator = createSyncCoordinator({
      readFile: async (p) => `body of ${p}`,
      stat: async () => ({ mtimeNs: 5, size: 10 }),
      syncFile: async (p) => { synced.push(p); return { indexed: 1 }; },
      evictFile: async () => 0,
      debounceMs: 10,
      now: () => clock,
    });

    coordinator.handle('update', 'Notes/a.md');
    clock = 20;
    await coordinator.flush();
    expect(synced).toEqual(['Notes/a.md']);

    coordinator.handle('update', 'Notes/a.md');
    clock = 40;
    await coordinator.flush();
    expect(synced).toEqual(['Notes/a.md']); // unchanged: not synced again
  });

  test('re-syncs a file whose size changed', async () => {
    let clock = 0;
    const synced = [];
    let size = 10;
    const coordinator = createSyncCoordinator({
      readFile: async (p) => `body of ${p}`,
      stat: async () => ({ mtimeNs: 5, size }),
      syncFile: async (p) => { synced.push(p); return { indexed: 1 }; },
      evictFile: async () => 0,
      debounceMs: 10,
      now: () => clock,
    });

    coordinator.handle('update', 'Notes/a.md');
    clock = 20;
    await coordinator.flush();

    size = 99;
    coordinator.handle('update', 'Notes/a.md');
    clock = 40;
    await coordinator.flush();

    expect(synced).toEqual(['Notes/a.md', 'Notes/a.md']);
  });

  test('evicts a deleted file', async () => {
    let clock = 0;
    const evicted = [];
    const coordinator = createSyncCoordinator({
      readFile: async () => 'x',
      stat: async () => ({ mtimeNs: 1, size: 1 }),
      syncFile: async () => ({ indexed: 1 }),
      evictFile: async (p) => { evicted.push(p); return 3; },
      debounceMs: 10,
      now: () => clock,
    });

    coordinator.handle('delete', 'Notes/gone.md');
    clock = 20;
    const results = await coordinator.flush();

    expect(evicted).toEqual(['Notes/gone.md']);
    expect(results[0]).toMatchObject({ relativePath: 'Notes/gone.md', outcome: 'evicted', count: 3 });
  });

  test('one failing file does not stop the sweep', async () => {
    let clock = 0;
    const synced = [];
    const logged = [];
    const coordinator = createSyncCoordinator({
      readFile: async (p) => { if (p === 'Notes/bad.md') throw new Error('unreadable'); return `body of ${p}`; },
      stat: async () => ({ mtimeNs: 1, size: 1 }),
      syncFile: async (p) => { synced.push(p); return { indexed: 1 }; },
      evictFile: async () => 0,
      debounceMs: 10,
      now: () => clock,
      logger: (p) => logged.push(p),
    });

    coordinator.handle('update', 'Notes/bad.md');
    coordinator.handle('update', 'Notes/good.md');
    clock = 20;
    const results = await coordinator.flush();

    expect(synced).toEqual(['Notes/good.md']);
    expect(logged).toEqual(['Notes/bad.md']);
    expect(results.some((r) => r.outcome === 'failed')).toBe(true);
    expect(results.some((r) => r.outcome === 'synced')).toBe(true);
  });
});

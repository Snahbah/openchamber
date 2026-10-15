import { describe, expect, test } from 'bun:test';

import { createIndexQueue } from './index-queue.js';

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

const ENTRY = { id: 'mem_1', title: 'Uses bun', body: 'Tests run with bun.', type: 'fact' };

describe('index queue', () => {
  test('enqueues without awaiting and processes promote + syncFile', async () => {
    const calls = [];
    const queue = createIndexQueue({
      promote: async (entry) => {
        calls.push(['promote', entry.id]);
        return `/vault/Artifacts/${entry.id}.md`;
      },
      syncFile: async (notePath) => {
        calls.push(['sync', notePath]);
      },
    });

    // enqueue is synchronous and returns nothing — the caller never awaits it.
    expect(queue.enqueue(ENTRY, 'global')).toBeUndefined();

    await settle();
    expect(calls).toEqual([
      ['promote', 'mem_1'],
      ['sync', '/vault/Artifacts/mem_1.md'],
    ]);
    expect(queue.stats().processed).toBe(1);
    expect(queue.stats().pending).toBe(0);
    expect(queue.stats().errors).toBe(0);
  });

  test('skips flagged entries, which are held back from sessions anyway', async () => {
    const calls = [];
    const queue = createIndexQueue({
      promote: async () => {
        calls.push('promote');
        return '/vault/x.md';
      },
      syncFile: async () => {
        calls.push('sync');
      },
    });

    queue.enqueue({ ...ENTRY, flagged: true }, 'global');
    await settle();

    expect(calls).toEqual([]);
    expect(queue.stats().processed).toBe(0);
    expect(queue.stats().pending).toBe(0);
  });

  test('retries with backoff, then counts an error once attempts are exhausted', async () => {
    let promoteCalls = 0;
    const queue = createIndexQueue({
      promote: async () => {
        promoteCalls += 1;
        throw new Error('vault down');
      },
      syncFile: async () => {},
      baseBackoffMs: 5,
      maxAttempts: 2,
    });

    queue.enqueue(ENTRY, 'global');
    await new Promise((resolve) => setTimeout(resolve, 100));

    // initial + 2 retries = 3 promote calls; then the job is dropped as an error.
    expect(promoteCalls).toBe(3);
    expect(queue.stats().retried).toBe(2);
    expect(queue.stats().errors).toBe(1);
    expect(queue.stats().pending).toBe(0);
  });

  test('drops anything enqueued after stop', () => {
    const queue = createIndexQueue({
      promote: async () => '/vault/x.md',
      syncFile: async () => {},
    });
    queue.stop();
    queue.enqueue(ENTRY, 'global');
    expect(queue.stats().dropped).toBe(1);
    expect(queue.stats().pending).toBe(0);
  });
});

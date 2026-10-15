import { describe, expect, test, beforeEach, afterEach } from 'bun:test';

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { createEventLog } from './event-log.js';

const EVENT = (overrides = {}) => ({
  kind: 'turn_closed',
  source_provenance: { substrate_kind: 'session', source: 'session-1' },
  ...overrides,
});

describe('episodic event log', () => {
  let rootDir;
  let log;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-event-log-'));
    log = createEventLog({ fsPromises: fs, path, logDir: rootDir });
    await log.boot();
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  test('assigns a monotonic seq to every event, in append order', async () => {
    await log.append(EVENT());
    await log.append(EVENT());
    await log.append(EVENT());

    const events = await log.replay();
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  test('resumes seq across a restart from the same directory', async () => {
    await log.append(EVENT());
    await log.append(EVENT());

    const restarted = createEventLog({ fsPromises: fs, path, logDir: rootDir });
    const bootState = await restarted.boot();
    expect(bootState.seq).toBe(2);
    expect(bootState.count).toBe(2);

    await restarted.append(EVENT());
    expect((await restarted.replay()).map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  test('refuses an unattributed event in strict provenance mode', async () => {
    await expect(log.append({ kind: 'turn_closed' })).rejects.toThrow('substrate_kind is required');
  });

  test('allows an unattributed event when strict provenance is off', async () => {
    const loose = createEventLog({ fsPromises: fs, path, logDir: rootDir, strictProvenance: false });
    await loose.boot();
    expect(await loose.append({ kind: 'heartbeat' })).toBe(true);
  });

  test('fails open on a write error rather than throwing', async () => {
    const broken = createEventLog({
      fsPromises: {
        ...fs,
        appendFile: async () => { throw new Error('disk full'); },
      },
      path,
      logDir: rootDir,
    });
    await broken.boot();
    expect(await broken.append(EVENT())).toBe(false);
  });

  test('skips a corrupt line rather than failing the read', async () => {
    await log.append(EVENT());
    await fs.appendFile(path.join(rootDir, 'events.jsonl'), 'not-json\n', 'utf8');

    const events = await log.replay();
    expect(events.length).toBe(1);
    expect(events[0].kind).toBe('turn_closed');
  });

  test('rotates to an archive at the size cap and replay chains across it', async () => {
    const small = createEventLog({
      fsPromises: fs,
      path,
      logDir: rootDir,
      maxLogSize: 400,
      now: () => new Date('2026-09-27T00:00:00.000Z'),
    });
    await small.boot();

    for (let i = 0; i < 20; i += 1) {
      await small.append(EVENT({ payload: { i } }));
    }

    const archiveDir = path.join(rootDir, 'archive');
    const archiveFiles = await fs.readdir(archiveDir);
    expect(archiveFiles.length).toBeGreaterThan(0);

    const events = await small.replay();
    expect(events.map((e) => e.seq)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(await small.count()).toBe(20);
  });

  test('tail returns the newest N events', async () => {
    for (let i = 0; i < 5; i += 1) {
      await log.append(EVENT({ payload: { i } }));
    }
    const newest = await log.tail(2);
    expect(newest.map((e) => e.payload.i)).toEqual([3, 4]);
  });

  test('count reflects the full store across archives', async () => {
    for (let i = 0; i < 10; i += 1) {
      await log.append(EVENT());
    }
    expect(await log.count()).toBe(10);
  });
});

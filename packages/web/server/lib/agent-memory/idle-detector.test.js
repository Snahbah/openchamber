import { describe, expect, test } from 'bun:test';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { writeIdleTranscripts } from './idle-detector.js';

const THRESHOLD = 30 * 60 * 1000; // 30 minutes
const NOW = 10_000_000;

const createDeps = (overrides = {}) => {
  const pendingDir = path.join(os.tmpdir(), `oc-idle-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  return {
    pendingDir,
    listSessions: async () => [],
    readTranscript: async () => null,
    fsPromises,
    thresholdMs: THRESHOLD,
    now: () => NOW,
    ...overrides,
  };
};

describe('writeIdleTranscripts', () => {
  test('writes a transcript for a session idle beyond the threshold, skips a fresh one', async () => {
    const deps = createDeps({
      listSessions: async () => [
        { id: 'ses_old', lastActivity: 0 }, // idle the full 10s window, well past 30 min
        { id: 'ses_fresh', lastActivity: NOW - 1_000 }, // idle 1s
      ],
      readTranscript: async (id) => ({
        sessionId: id,
        domain: 'rev-routing',
        turns: [{ turnId: 't1', text: 'hi' }],
        files: {},
      }),
    });

    const result = await writeIdleTranscripts(deps);
    expect(result.written).toBe(1);
    expect(result.skipped).toBe(1);

    const text = await fsPromises.readFile(path.join(deps.pendingDir, 'ses_old.json'), 'utf8');
    expect(JSON.parse(text).sessionId).toBe('ses_old');
  });

  test('skips a session whose transcript is null', async () => {
    const deps = createDeps({
      listSessions: async () => [{ id: 'ses_empty', lastActivity: 0 }],
      readTranscript: async () => null,
    });
    const result = await writeIdleTranscripts(deps);
    expect(result.written).toBe(0);
    expect(result.skipped).toBe(1);
  });
});

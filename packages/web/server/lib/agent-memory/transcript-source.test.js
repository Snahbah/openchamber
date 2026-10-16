import { basename } from 'node:path';
import { describe, expect, test } from 'bun:test';

import { createTranscriptSource } from './transcript-source.js';

const fakeClient = (overrides = {}) => ({
  session: {
    list: async ({ cursor }) =>
      cursor
        ? { data: [], cursor: { next: null } }
        : {
            data: [
              { id: 'ses_old', time: { updated: 1_000 } },
              { id: 'ses_fresh', time: { updated: Date.now() } },
            ],
            cursor: { next: null },
          },
    get: async ({ sessionID }) => ({ id: sessionID, location: { directory: '/repo' } }),
  },
  message: {
    list: async () => ({
      data: [
        { id: 'm1', type: 'user', text: 'refactor the pool' },
        { id: 'm2', type: 'assistant', content: [{ type: 'text', text: 'done' }] },
      ],
      cursor: { next: null },
    }),
  },
  ...overrides,
});

const makeSource = (overrides = {}) => {
  const clients = new Map();
  const source = createTranscriptSource({
    createClient: (directory) => {
      if (!clients.has(directory)) clients.set(directory, fakeClient());
      return clients.get(directory);
    },
    getStatus: async () => ({ files: [{ path: 'src/pool.ts', index: 'M', working_dir: 'M' }] }),
    getRepositoryRoot: async () => '/repo',
    readFile: async (path) => (basename(path) === 'pool.ts' ? 'export const pool = [];\n' : null),
    ...overrides,
  });
  return { source, clients };
};

describe('createTranscriptSource', () => {
  test('listSessions returns every session with its last activity', async () => {
    const { source } = makeSource();
    const sessions = await source.listSessions();
    expect(sessions).toEqual([
      { id: 'ses_old', lastActivity: 1_000 },
      { id: 'ses_fresh', lastActivity: expect.any(Number) },
    ]);
  });

  test('readTranscript shapes turns + the working-tree files (not empty)', async () => {
    const { source } = makeSource();
    const transcript = await source.readTranscript('ses_old');

    expect(transcript).not.toBeNull();
    expect(transcript.schemaVersion).toBe('1.0.0');
    expect(transcript.sessionId).toBe('ses_old');
    expect(transcript.domain).toBe('repo');
    expect(transcript.turns).toEqual([
      { turnId: 'm1', text: 'refactor the pool' },
      { turnId: 'm2', text: 'done' },
    ]);
    // The whole point: the files the session touched are carried with content.
    expect(transcript.files).toEqual({ 'src/pool.ts': 'export const pool = [];\n' });
  });

  test('readTranscript returns null when a session has no settled text', async () => {
    const { source } = makeSource({
      createClient: (directory) => {
        const client = fakeClient();
        client.message.list = async () => ({ data: [], cursor: { next: null } });
        return client;
      },
    });
    expect(await source.readTranscript('ses_empty')).toBeNull();
  });

  test('readTranscript skips deleted/unreadable files', async () => {
    const { source } = makeSource({
      getStatus: async () => ({
        files: [
          { path: 'src/pool.ts', index: 'M', working_dir: 'M' },
          { path: 'src/gone.ts', index: 'D', working_dir: 'D' },
        ],
      }),
    });
    const transcript = await source.readTranscript('ses_old');
    expect(transcript.files).toEqual({ 'src/pool.ts': 'export const pool = [];\n' });
  });
});

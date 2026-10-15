import { describe, expect, test } from 'bun:test';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { mirrorSessionLearnings, parseSessionLearnings } from './session-learning-mirror.js';

describe('parseSessionLearnings', () => {
  test('returns only verified learnings, with sessionId/domain/index, tolerating junk lines', () => {
    const text = [
      JSON.stringify({
        schemaVersion: '1.0.0',
        type: 'session_learning',
        sessionId: 'ses_1',
        timestamp: '2026-10-15T00:00:00.000Z',
        domain: 'rev-routing',
        learnings: [
          { kind: 'decision', summary: 'Verified one.', evidence: [], cost: 'high', verified: true },
          { kind: 'mistake', summary: 'Quarantined one.', evidence: [], cost: 'high', verified: false },
        ],
      }),
      'not json',
      JSON.stringify({ type: 'other' }),
    ].join('\n');

    const result = parseSessionLearnings(text);
    expect(result).toHaveLength(1);
    expect(result[0]?.learning.summary).toBe('Verified one.');
    expect(result[0]?.sessionId).toBe('ses_1');
    expect(result[0]?.domain).toBe('rev-routing');
    expect(result[0]?.index).toBe(0);
  });
});

describe('mirrorSessionLearnings', () => {
  test('promotes verified learnings and syncs their notes, skipping quarantined', async () => {
    const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'oc-mirror-'));
    const filePath = path.join(directory, 'session_learning.jsonl');
    await fsPromises.writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: '1.0.0',
        type: 'session_learning',
        sessionId: 'ses_1',
        timestamp: '2026-10-15T00:00:00.000Z',
        domain: 'rev-routing',
        learnings: [
          { kind: 'decision', summary: 'Verified.', evidence: [], cost: 'high', verified: true },
          { kind: 'mistake', summary: 'Quarantined.', evidence: [], cost: 'high', verified: false },
        ],
      }) + '\n',
      'utf8',
    );

    const promoted = [];
    const synced = [];
    await mirrorSessionLearnings({
      filePath,
      fsPromises,
      promoteSessionLearning: async (learning, sessionId, domain, index) => {
        promoted.push({ learning, sessionId, domain, index });
        return { noteId: `sl_${sessionId}_${index}`, path: `/vault/Artifacts/sl_${sessionId}_${index}.md` };
      },
      syncFile: async (notePath) => {
        synced.push(notePath);
      },
    });

    expect(promoted).toHaveLength(1);
    expect(promoted[0]?.learning.summary).toBe('Verified.');
    expect(synced).toEqual(['/vault/Artifacts/sl_ses_1_0.md']);
  });

  test('tolerates a missing file', async () => {
    const promoted = [];
    await mirrorSessionLearnings({
      filePath: '/nonexistent/session_learning.jsonl',
      fsPromises,
      promoteSessionLearning: async () => {
        promoted.push(1);
        return { noteId: 'x', path: '/x' };
      },
      syncFile: async () => {},
    });
    expect(promoted).toHaveLength(0);
  });
});

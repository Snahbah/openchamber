import { describe, expect, test } from 'bun:test';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

import { createVaultPromotionRuntime } from './vault-promotion.js';

const createRuntime = async () => {
  const rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'oc-sl-'));
  const runtime = createVaultPromotionRuntime({
    fsPromises,
    path,
    vaultArtifactsDir: path.join(rootDir, 'Agents Vault', 'Artifacts'),
  });
  return { rootDir, runtime };
};

describe('session learning promotion', () => {
  test('writes a note keyed by sl_<sessionId>_<index> with session_learning frontmatter', async () => {
    const { runtime } = await createRuntime();
    const result = await runtime.promoteSessionLearning(
      { kind: 'decision', summary: 'Capped the pool at ten.', cost: 'medium', verified: true },
      'ses_1',
      'rev-routing',
      0,
    );
    expect(result.noteId).toBe('sl_ses_1_0');

    const note = await fsPromises.readFile(result.path, 'utf8');
    const frontmatter = parseYaml(note.split('---')[1]);
    expect(frontmatter.type).toBe('session_learning');
    expect(frontmatter.summary).toBe('Capped the pool at ten.');
    expect(frontmatter.cost).toBe('medium');
    expect(frontmatter.verified).toBe(true);
    expect(frontmatter.sessionId).toBe('ses_1');
    expect(frontmatter.domain).toBe('rev-routing');
  });

  test('re-promotion overwrites the same note (idempotent)', async () => {
    const { runtime } = await createRuntime();
    const first = await runtime.promoteSessionLearning(
      { kind: 'decision', summary: 'First version.', cost: 'low', verified: true },
      'ses_1',
      'rev-routing',
      0,
    );
    const second = await runtime.promoteSessionLearning(
      { kind: 'decision', summary: 'Second version.', cost: 'low', verified: true },
      'ses_1',
      'rev-routing',
      0,
    );
    expect(second.path).toBe(first.path);
    const note = await fsPromises.readFile(first.path, 'utf8');
    expect(note).toContain('Second version.');
    expect(note).not.toContain('First version.');
  });
});

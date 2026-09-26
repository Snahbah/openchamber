import { describe, expect, test } from 'bun:test';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

import { createVaultPromotionRuntime } from './vault-promotion.js';

const ENTRY = {
  id: 'mem_abc123',
  title: 'Uses bun',
  body: 'Tests run with bun test.',
  type: 'fact',
  createdAt: 1750000000000,
  updatedAt: 1750000000000,
};

const createRuntime = async () => {
  const rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'oc-vault-'));
  const runtime = createVaultPromotionRuntime({
    fsPromises,
    path,
    vaultArtifactsDir: path.join(rootDir, 'Agents Vault', 'Artifacts'),
  });
  return { rootDir, runtime };
};

describe('vault promotion', () => {
  test('writes a note with parseable YAML frontmatter and a markdown body', async () => {
    const { runtime } = await createRuntime();

    const result = await runtime.promote(ENTRY, 'project');
    const raw = await fsPromises.readFile(result.path, 'utf8');

    const parts = raw.split('---').map((part) => part.trim());
    const frontmatter = parseYaml(parts[1]);

    expect(frontmatter.id).toBe('mem_abc123');
    expect(frontmatter.title).toBe('Uses bun');
    expect(frontmatter.type).toBe('fact');
    expect(frontmatter.scope).toBe('project');
    expect(frontmatter.salience).toBe('promoted');
    expect(frontmatter.tags).toEqual(['fact', 'project']);

    expect(parts[2]).toContain('# Uses bun');
    expect(parts[2]).toContain('Tests run with bun test.');
  });

  test('re-promotion overwrites the same note rather than duplicating it', async () => {
    const { rootDir, runtime } = await createRuntime();

    const first = await runtime.promote(ENTRY, 'project');
    await runtime.promote({ ...ENTRY, body: 'Changed body.' }, 'project');

    const files = await fsPromises.readdir(path.join(rootDir, 'Agents Vault', 'Artifacts'));
    expect(files).toEqual(['mem_abc123.md']);

    const raw = await fsPromises.readFile(first.path, 'utf8');
    expect(raw).toContain('Changed body.');
  });

  test('a title that would break bare YAML is quoted safely', async () => {
    const { runtime } = await createRuntime();

    const result = await runtime.promote({ ...ENTRY, title: 'A: "tricky" title' }, 'global');
    const raw = await fsPromises.readFile(result.path, 'utf8');

    const frontmatter = parseYaml(raw.split('---').map((part) => part.trim())[1]);
    expect(frontmatter.title).toBe('A: "tricky" title');
  });

  test('refuses a missing vault directory', () => {
    expect(() => createVaultPromotionRuntime({ fsPromises, path, vaultArtifactsDir: '' }))
      .toThrow('vaultArtifactsDir is required');
  });
});

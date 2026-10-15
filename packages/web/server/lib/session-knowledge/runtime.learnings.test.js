import { describe, expect, test } from 'bun:test';

import { createSessionKnowledgeRuntime } from './runtime.js';

const DIRECTORY = '/work/project';

const createRuntime = (queryMemory) => createSessionKnowledgeRuntime({
  resolveProjectId: async () => 'path_project',
  projectContextRuntime: { readContext: async () => ({ notes: [], todos: [], plans: [] }) },
  agentMemoryRuntime: {
    readAll: async () => ({ global: [], project: [], globalFailed: false, projectFailed: false }),
  },
  isAgentMemoryEnabled: async () => false,
  queryMemory,
});

describe('session learnings', () => {
  test('surfaces session_learning records as a distinct [recall — session_learning] block', async () => {
    const runtime = createRuntime(async () => ({
      ranking: new Map(),
      learnings: [
        { summary: 'We burned an hour re-deriving the pool limit', cost: 'high', verified: true },
        { summary: 'The CI flake is the timeout, not the test', cost: 'medium', verified: false },
      ],
    }));

    const { text } = await runtime.resolvePending(DIRECTORY, '', { notes: [], plans: [] }, 'tune the pool');

    expect(text).toContain('[recall — session_learning]');
    expect(text).toContain('We burned an hour re-deriving the pool limit');
    expect(text).toContain('[cost: high]');
    expect(text).toContain('[cost: medium]');
    expect(text).toContain('[unverified]');
    // Learnings surface distinctly from the memory-title list, which is empty here.
    expect(text).not.toContain('### About the user');
    expect(runtime.stats().learnings_found).toBe(2);
    expect(runtime.stats().vault_misses).toBe(0);
  });

  test('renders no learnings block when there are none, and does not count it as a miss', async () => {
    const runtime = createRuntime(async () => ({ ranking: new Map(), learnings: [] }));

    const { text } = await runtime.resolvePending(DIRECTORY, '', { notes: [], plans: [] }, 'tune the pool');

    expect(text).not.toContain('[recall — session_learning]');
    // The key metric: an empty learnings result is Phase-2-not-run, not a broken
    // read path — so vault_misses stays 0 and learnings_found is the honest zero.
    expect(runtime.stats().learnings_found).toBe(0);
    expect(runtime.stats().vault_misses).toBe(0);
  });

  test('counts a vault query failure as vault_misses, distinct from an empty learnings result', async () => {
    const runtime = createRuntime(async () => {
      throw new Error('vault locked');
    });

    await runtime.resolvePending(DIRECTORY, '', { notes: [], plans: [] }, 'tune the pool');

    expect(runtime.stats().vault_misses).toBe(1);
    expect(runtime.stats().fallback_reason).toContain('vault locked');
    expect(runtime.stats().learnings_found).toBe(0);
  });
});

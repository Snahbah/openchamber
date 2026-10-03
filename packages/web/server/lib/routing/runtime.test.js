import { describe, expect, it, vi } from 'vitest';
import { createRoutingRuntime, requestTextOf } from './runtime.js';
import { resolveEffectiveConfig } from './store.js';
import { excerptHead, excerptHeadTail, turnsToHistory } from './history.js';
import { askRev, buildRoutingRequest, createJevClient, decidePermission, decideRouting, evaluateRevSafety } from './jev.js';

const AUTO = { providerID: 'openchamber', id: 'auto' };
const FALLBACK = { model: { providerID: 'anthropic', modelID: 'claude-sonnet-5' }, variant: 'medium' };

const readyConfig = () => {
  const config = resolveEffectiveConfig(null);
  config.enabled = true;
  config.fallback = FALLBACK;
  config.safetyNet = { enabled: true, threshold: 0.6 };
  config.categories = config.categories.map((c) => (c.id === 'hard'
    ? { ...c, model: { providerID: 'openai', modelID: 'gpt-6-astra' }, variant: 'high', agent: 'plan' }
    : c));
  return config;
};

const makeRuntime = ({ config = readyConfig(), token = 'key', answers, askError, revUrl = null } = {}) => {
  const events = [];
  const store = {
    readConfig: vi.fn(async () => config),
    writeConfig: vi.fn(async (next) => next),
    readToken: vi.fn(async () => token),
    writeToken: vi.fn(async () => undefined),
    clearToken: vi.fn(async () => undefined),
  };
  const jev = { ask: vi.fn(async () => { if (askError) throw askError; return { answers, ms: 12 }; }) };
  const runtime = createRoutingRuntime({
    dataDir: '/unused',
    buildOpenCodeUrl: () => 'http://127.0.0.1:1/',
    getOpenCodeAuthHeaders: () => ({}),
    broadcastGlobalUiEvent: (event) => events.push(event),
    store,
    revUrl,
    jev,
  });
  return { runtime, store, jev, events };
};

describe('requestTextOf', () => {
  it('reads the prompt text a v2 send carries', () => {
    expect(requestTextOf({ text: '  fix the typo in README  ', files: [{ uri: 'data:...' }] })).toBe('fix the typo in README');
  });
  it('renders a v2 command body (`name` plus `text`) as the slash command', () => {
    expect(requestTextOf({ name: 'review', text: ' src ' })).toBe('/review src');
  });
  it('keeps the command name when it has no arguments', () => {
    expect(requestTextOf({ name: 'review', text: '' })).toBe('/review');
    expect(requestTextOf({ name: 'review' })).toBe('/review');
  });
});

describe('history excerpts', () => {
  it('keeps the head of a user message and head plus tail of an answer', () => {
    const long = 'a'.repeat(1000);
    expect(excerptHead(long, 600)).toBe(`${'a'.repeat(600)} […]`);
    expect(excerptHeadTail(`${'h'.repeat(400)}${'m'.repeat(400)}${'t'.repeat(400)}`, 300, 300)).toBe(`${'h'.repeat(300)} […] ${'t'.repeat(300)}`);
    expect(excerptHead('short', 600)).toBe('short');
  });
  it('flattens the last three turns oldest first', () => {
    const turns = [1, 2, 3, 4].map((n) => ({ user: { text: `u${n}` }, assistant: { text: `a${n}` } }));
    expect(turnsToHistory(turns)).toEqual([
      { role: 'user', text: 'u2' }, { role: 'assistant', text: 'a2' },
      { role: 'user', text: 'u3' }, { role: 'assistant', text: 'a3' },
      { role: 'user', text: 'u4' }, { role: 'assistant', text: 'a4' },
    ]);
  });
});

describe('decisions', () => {
  const categories = readyConfig().categories;
  it('routes a confident known category and falls back otherwise', () => {
    expect(decideRouting({ choice: 'hard', confidence: 0.9 }, { categories, minConfidence: 0.6 }).reason).toBe('routed');
    expect(decideRouting({ choice: 'hard', confidence: 0.4 }, { categories, minConfidence: 0.6 })).toMatchObject({ category: null, reason: 'low-confidence' });
    expect(decideRouting({ choice: 'nope', confidence: 0.99 }, { categories, minConfidence: 0.6 })).toMatchObject({ category: null, reason: 'unknown-category' });
  });
  it('holds a permission at or above the threshold', () => {
    expect(decidePermission({ ask: { noul: 0.61 }, kind: { choice: 'git_history' } }, { threshold: 0.6 })).toEqual({ hold: true, score: 0.61, kind: 'git_history' });
    expect(decidePermission({ ask: { noul: 0.2 }, kind: { choice: 'read_only' } }, { threshold: 0.6 }).hold).toBe(false);
    expect(() => decidePermission({}, { threshold: 0.6 })).toThrow(/ask score/);
  });
});

describe('askRev', () => {
  const revResponse = ({ complexity = 'trivial_syntax', retainActiveModel = false, allowedTools = [], degraded = false } = {}) =>
    async (url, init) => ({ ok: true, status: 200, json: async () => ({ complexity, retainActiveModel, allowedTools, degraded }) });
  const req = (over = {}) => ({ state: { sessionId: 's1', request: 'fix', activeModel: null, ...over }, questions: { category: { criteria: {} } } });

  it('surfaces retainActiveModel and allowedTools from the Rev decision', async () => {
    const out = await askRev({
      endpoint: { url: 'http://rev' },
      request: req({ activeModel: { id: 'nemotron-3-super', providerID: 'local' } }),
      fetchImpl: revResponse({ complexity: 'complex_refactor', retainActiveModel: true, allowedTools: ['read'] }),
      signal: new AbortController().signal,
      started: 0,
    });
    expect(out.retainActiveModel).toBe(true);
    expect(out.allowedTools).toEqual(['read']);
  });

  it('sends the real session model id, not a hardcoded one', async () => {
    let body = null;
    await askRev({
      endpoint: { url: 'http://rev' },
      request: req({ activeModel: { id: 'nemotron-3-super', providerID: 'local' } }),
      fetchImpl: async (url, init) => { body = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ complexity: 'trivial_syntax', retainActiveModel: false, allowedTools: [], degraded: false }) }; },
      signal: new AbortController().signal,
      started: 0,
    });
    expect(body.activeModelId).toBe('local/nemotron-3-super');
  });

  it('falls back to a placeholder id when no session model is available', async () => {
    let body = null;
    await askRev({
      endpoint: { url: 'http://rev' },
      request: req(),
      fetchImpl: async (url, init) => { body = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ complexity: 'trivial_syntax', retainActiveModel: false, allowedTools: [], degraded: false }) }; },
      signal: new AbortController().signal,
      started: 0,
    });
    expect(body.activeModelId).toBe('qwen2.5-coder-32b');
  });
});

describe('buildRoutingRequest', () => {
  it('carries the session model so Rev measures KV affinity against it', () => {
    const out = buildRoutingRequest({ categories: [], history: [], request: 'fix', activeModel: { id: 'nemotron-3-super', providerID: 'local', variant: null } });
    expect(out.state.activeModel).toEqual({ id: 'nemotron-3-super', providerID: 'local', variant: null });
  });
  it('leaves activeModel null when not given, so callers route on the request alone', () => {
    expect(buildRoutingRequest({ categories: [], history: [], request: 'fix' }).state.activeModel).toBeNull();
  });
});

describe('resolveAutoSelection', () => {
  const send = (extra = {}) => ({ sessionId: 's1', model: AUTO, requestText: 'find the root cause', ...extra });

  it('leaves a real model untouched and does not consult Jev', async () => {
    const { runtime, jev } = makeRuntime({ answers: {} });
    expect(await runtime.resolveAutoSelection(send({ model: { providerID: 'anthropic', id: 'claude-opus-5' } }))).toBeNull();
    expect(jev.ask).not.toHaveBeenCalled();
  });

  it('answers with the routed category model, variant and agent', async () => {
    const { runtime, events } = makeRuntime({ answers: { category: { choice: 'hard', confidence: 0.97 } } });
    const resolved = await runtime.resolveAutoSelection(send({ agent: 'build' }));
    expect(resolved.model).toEqual({ providerID: 'openai', id: 'gpt-6-astra', variant: 'high' });
    expect(resolved.agent).toBe('plan');
    expect(resolved.decision).toMatchObject({ category: 'hard', reason: 'routed', confidence: 0.97 });
    expect(events.at(-1)).toMatchObject({ type: 'openchamber:routing.decision', properties: { sessionId: 's1', category: 'hard' } });
  });

  it('uses the fallback pair and keeps the composer agent when the category has no model', async () => {
    const { runtime } = makeRuntime({ answers: { category: { choice: 'trivial', confidence: 0.99 } } });
    const resolved = await runtime.resolveAutoSelection(send({ agent: 'build', requestText: 'fix typo' }));
    expect(resolved.model).toEqual({ providerID: 'anthropic', id: 'claude-sonnet-5', variant: 'medium' });
    expect(resolved.agent).toBe('build');
  });

  it('falls back on low confidence and on a Jev failure, and records why', async () => {
    const low = makeRuntime({ answers: { category: { choice: 'hard', confidence: 0.3 } } });
    const lowResolved = await low.runtime.resolveAutoSelection(send());
    expect(lowResolved.decision.reason).toBe('low-confidence');
    expect(lowResolved.model).toMatchObject({ providerID: 'anthropic', id: 'claude-sonnet-5' });

    const failing = makeRuntime({ askError: Object.assign(new Error('Jev responded 401'), { status: 401 }) });
    const resolved = await failing.runtime.resolveAutoSelection(send());
    expect(resolved.decision).toMatchObject({ reason: 'error', error: 'Jev responded 401' });
    expect(resolved.model).toMatchObject({ providerID: 'anthropic', id: 'claude-sonnet-5' });
  });

  it('falls back without asking Jev while Auto is not ready, and refuses without a fallback', async () => {
    const config = readyConfig();
    config.enabled = false;
    const notReady = makeRuntime({ config, answers: {} });
    const resolved = await notReady.runtime.resolveAutoSelection(send());
    expect(resolved.decision.reason).toBe('not-ready');
    expect(resolved.model).toMatchObject({ providerID: 'anthropic', id: 'claude-sonnet-5' });
    expect(notReady.jev.ask).not.toHaveBeenCalled();

    const noFallback = makeRuntime({ config: { ...readyConfig(), fallback: null }, answers: {} });
    await expect(noFallback.runtime.resolveAutoSelection(send())).rejects.toMatchObject({ status: 400 });
  });
});

describe('jev endpoint', () => {
  const capture = async (token, options) => {
    let call = null;
    const fetchImpl = async (url, init) => {
      call = { url, init };
      return { ok: true, status: 200, text: async () => JSON.stringify({ answers: {} }) };
    };
    await createJevClient({ fetchImpl, ...options }).ask({ state: 'x', questions: {} }, token);
    return { url: call.url, headers: call.init.headers, body: JSON.parse(call.init.body) };
  };

  it('sends a saved key to TypeSafe and falls back to local Rev or free zen without one', async () => {
    const keyed = await capture('secret');
    expect(keyed.url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(keyed.headers.authorization).toBe('Bearer secret');
    expect(keyed.body.model).toBe('jev-latest');

    const free = await capture(null, { revUrl: null });
    expect(free.url).toBe('https://opencode.ai/zen/v1/systemone');
    expect(free.headers.authorization).toBeUndefined();
    // Zen counts our calls by this header, and does not know the `jev-latest` alias.
    expect(free.headers['x-opencode-client']).toBe('openchamber');
    expect(free.body.model).toBe('jev-1.13-free');
  });

  it('routes to local Rev daemon for pre-turn classification', async () => {
    let revCall = null;
    const fetchImpl = async (url, init) => {
      revCall = { url, init };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          complexity: 'trivial_syntax',
          assignedTier: 'standard_coder',
          degraded: false,
        }),
      };
    };
    const client = createJevClient({ fetchImpl, revUrl: 'http://127.0.0.1:3840' });
    const result = await client.ask({
      state: { request: 'fix typo' },
      questions: { category: { criteria: { trivial: 'desc', implement: 'desc' } } },
    }, null);

    expect(revCall.url).toBe('http://127.0.0.1:3840/hook/pre-turn');
    expect(JSON.parse(revCall.init.body).prompt).toBe('fix typo');
    expect(result.answers.category).toEqual({ choice: 'trivial', confidence: 0.95 });
  });

  it('evaluates Rev safety net deterministically for risky actions', async () => {
    const client = createJevClient({ revUrl: 'http://127.0.0.1:3840' });
    const risky = await client.ask({
      state: { permission: { type: 'bash', patterns: ['git push --force origin main'] } },
      questions: { ask: {} },
    }, null);
    expect(risky.answers.ask.noul).toBeGreaterThanOrEqual(0.6);
    expect(risky.answers.kind.choice).toBe('git_history');

    const safe = await client.ask({
      state: { permission: { type: 'edit', patterns: ['src/index.ts'] } },
      questions: { ask: {} },
    }, null);
    expect(safe.answers.ask.noul).toBeLessThan(0.6);
  });
});

describe('auto sessions', () => {
  it('remembers the sentinel selection and forgets it when a real model is chosen', () => {
    const { runtime } = makeRuntime({ answers: {} });
    expect(runtime.isAutoSession('s1')).toBe(false);
    expect(runtime.noteModelSelection('s1', AUTO, '/repo')).toBe(true);
    expect(runtime.isAutoSession('s1')).toBe(true);
    expect(runtime.noteModelSelection('s1', { providerID: 'anthropic', id: 'claude-opus-5' }, '/repo')).toBe(false);
    expect(runtime.isAutoSession('s1')).toBe(false);
  });
});

describe('evaluatePermission', () => {
  const permission = { id: 'p1', sessionID: 's1', permission: 'bash', patterns: ['git push --force'], metadata: { command: 'git push --force origin main' } };

  it('holds a risky permission and remembers the decision', async () => {
    const { runtime, jev, events } = makeRuntime({ answers: { ask: { noul: 0.9 }, kind: { choice: 'git_history' } } });
    expect(await runtime.evaluatePermission(permission, '/repo')).toEqual({ action: 'hold', score: 0.9, kind: 'git_history' });
    expect(await runtime.evaluatePermission(permission, '/repo')).toEqual({ action: 'hold', score: 0.9, kind: 'git_history' });
    expect(jev.ask).toHaveBeenCalledTimes(1);
    expect(events.filter((e) => e.type === 'openchamber:routing.permission-held')).toHaveLength(1);
    expect(runtime.heldPermissions()).toEqual([{ permissionId: 'p1', score: 0.9, kind: 'git_history' }]);
    runtime.forgetPermission('p1');
    expect(runtime.heldPermissions()).toEqual([]);
  });

  it('accepts when Jev is unreachable and tells the UI it skipped', async () => {
    const { runtime, events } = makeRuntime({ askError: Object.assign(new Error('Jev timed out after 4000ms'), { code: 'timeout' }) });
    expect(await runtime.evaluatePermission(permission, '/repo')).toEqual({ action: 'accept', skipped: 'Jev timed out after 4000ms' });
    expect(events.at(-1)).toMatchObject({ type: 'openchamber:routing.safety-skipped', properties: { permissionId: 'p1', error: 'Jev timed out after 4000ms' } });
  });

  it('accepts without asking when the safety net is off', async () => {
    const off = readyConfig();
    off.safetyNet.enabled = false;
    const { runtime, jev } = makeRuntime({ config: off, answers: {} });
    expect(await runtime.evaluatePermission(permission, '/repo')).toEqual({ action: 'accept' });
    expect(jev.ask).not.toHaveBeenCalled();
  });
});

describe('describe', () => {
  it('reports Auto ready with an enabled config, a fallback and two categories, key or no key', async () => {
    expect((await makeRuntime({ answers: {} }).runtime.describe())).toMatchObject({ autoReady: true, tokenPresent: true, jevSource: 'typesafe' });
    // Without a key and with local Rev, rev-local answers.
    expect((await makeRuntime({ token: null, answers: {}, revUrl: 'http://127.0.0.1:3840' }).runtime.describe())).toMatchObject({ autoReady: true, tokenPresent: false, jevSource: 'rev-local' });
    // Without Rev and without a key the free Jev model on zen answers, so Auto stays available.
    expect((await makeRuntime({ token: null, answers: {}, revUrl: null }).runtime.describe())).toMatchObject({ autoReady: true, tokenPresent: false, jevSource: 'zen-free' });
    const one = readyConfig();
    one.categories = one.categories.map((c, i) => ({ ...c, enabled: i === 0 }));
    expect((await makeRuntime({ config: one, answers: {} }).runtime.describe()).autoReady).toBe(false);
  });
});

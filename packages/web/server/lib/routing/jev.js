/**
 * The Jev side of routing: request shapes and the HTTP call. Pure builders are
 * exported so the decision logic can be tested without a network.
 */
import { z } from 'zod';
import {
  JEV_API_URL,
  JEV_MODEL,
  JEV_TIMEOUT_MS,
  REV_API_URL,
  REV_MODEL,
  ROUTING_INSTRUCTIONS,
  SAFETY_INSTRUCTIONS,
  SAFETY_KINDS,
  ZEN_CLIENT_ID,
  ZEN_JEV_API_URL,
  ZEN_JEV_MODEL,
} from './defaults.js';

/**
 * Where one request goes. A saved TypeSafe key wins: the user chose it and it
 * carries their own quota. Without one, OpenChamber prefers the local sovereign
 * Rev daemon (REV_API_URL, default http://127.0.0.1:3840). If Rev is disabled,
 * the same questions go to the free Jev model OpenCode Zen serves without a
 * credential, identified as OpenChamber.
 */
export const jevEndpoint = (token, { revUrl = REV_API_URL } = {}) => {
  if (token) {
    return { url: JEV_API_URL, model: JEV_MODEL, headers: { authorization: `Bearer ${token}` }, source: 'typesafe' };
  }
  if (revUrl) {
    return { url: revUrl, model: REV_MODEL, headers: {}, source: 'rev-local' };
  }
  return { url: ZEN_JEV_API_URL, model: ZEN_JEV_MODEL, headers: { 'x-opencode-client': ZEN_CLIENT_ID }, source: 'zen-free' };
};

export const buildRoutingRequest = ({ categories, history, request, activeModel = null }) => {
  const criteria = {};
  for (const category of categories) criteria[category.id] = category.description;
  return {
    state: { history, request, activeModel },
    questions: { category: { type: 'choice', instructions: ROUTING_INSTRUCTIONS, criteria } },
  };
};

/** `permission` is what OpenCode reported: the tool kind, its patterns and its metadata. */
export const buildPermissionRequest = (permission) => ({
  state: {
    permission: {
      type: permission.permission,
      patterns: permission.patterns,
      metadata: permission.metadata,
    },
  },
  questions: {
    ask: { type: 'noul', instructions: SAFETY_INSTRUCTIONS },
    kind: { type: 'choice', instructions: 'What is the most significant effect of this action?', criteria: SAFETY_KINDS },
  },
});

const choiceAnswerSchema = z.object({ choice: z.string(), confidence: z.number() });
const noulAnswerSchema = z.object({ noul: z.number() });
const permissionAnswersSchema = z.object({
  ask: noulAnswerSchema,
  kind: z.object({ choice: z.string() }).partial().optional(),
});

/**
 * Maps a Jev answer onto the category to use. Anything short of a confident,
 * known, enabled category is the fallback; the reason says which.
 */
export const decideRouting = (answer, { categories, minConfidence }) => {
  const parsed = choiceAnswerSchema.safeParse(answer);
  if (!parsed.success) return { category: null, reason: 'unknown-category', confidence: 0 };
  const category = categories.find((c) => c.id === parsed.data.choice) ?? null;
  if (!category) return { category: null, reason: 'unknown-category', confidence: parsed.data.confidence };
  if (parsed.data.confidence < minConfidence) return { category: null, reason: 'low-confidence', confidence: parsed.data.confidence };
  return { category, reason: 'routed', confidence: parsed.data.confidence };
};

export const decidePermission = (answers, { threshold }) => {
  const parsed = permissionAnswersSchema.safeParse(answers);
  if (!parsed.success) throw new Error('Jev answer is missing the ask score');
  const score = parsed.data.ask.noul;
  return { hold: score >= threshold, score, kind: parsed.data.kind?.choice ?? null };
};

const responseSchema = z.object({ answers: z.record(z.string(), z.unknown()) });

/**
 * Deterministic permission safety evaluation for the local Rev sovereign plane.
 * Judges whether an action should hold for user confirmation or proceed.
 */
export const evaluateRevSafety = (type, command = '') => {
  const cmd = command.toLowerCase().trim();

  // Git destructive actions
  if (
    /\bgit\s+(?:push\s+.*(?:--force|-f\b|\+)|reset\s+--hard|clean\s+-[a-z]*f|branch\s+-[a-z]*d|rebase\s+-i)/i.test(cmd)
  ) {
    return { score: 0.95, kind: 'git_history' };
  }

  // Deleting broad data
  if (
    /\b(?:rm\s+-[a-z]*r[a-z]*f|rmdir\s+\/s|del\s+\/f\s+\/s|drop\s+(?:table|database)|truncate\s+table)/i.test(cmd)
  ) {
    return { score: 0.95, kind: 'deletes_data' };
  }

  // System level changes
  if (
    /\b(?:sudo|apt|apt-get|brew|yum|dnf|pacman|choco)\s+(?:install|remove|uninstall|upgrade)/i.test(cmd) ||
    /\b(?:npm|pnpm|yarn)\s+(?:install\s+-g|add\s+-g|global\s+add)/i.test(cmd) ||
    /(?:(?:\/etc|\/usr|\/var|~?\/\.ssh|~?\/\.gnupg|~?\/\.bashrc|~?\/\.zshrc)(?:\/|\b))/i.test(cmd)
  ) {
    return { score: 0.9, kind: 'system_change' };
  }

  // External network mutations
  if (/\bcurl\s+.*-[xX]\s*(?:post|put|delete|patch)\b/i.test(cmd)) {
    return { score: 0.85, kind: 'external_side_effect' };
  }

  // Routine safe development actions: reading, local edits, tests, standard git commands
  if (type === 'edit') {
    return { score: 0.2, kind: 'writes_project' };
  }

  return { score: 0.1, kind: 'read_only' };
};

export const askRev = async ({ endpoint, request, fetchImpl, signal, started }) => {
  // 1. Routing classification request
  if (request.questions?.category) {
    // The session's current model is the resident model Rev's KV affinity is
    // measured against. Feeding the real one (not a hardcoded id) is what makes
    // `retainActiveModel` a decision about this session rather than a guess.
    const activeModel = request.state?.activeModel ?? null;
    const activeModelId = activeModel ? `${activeModel.providerID}/${activeModel.id}` : 'qwen2.5-coder-32b';
    const preTurnPayload = {
      sessionId: request.state?.sessionId || '00000000-0000-0000-0000-000000000000',
      prompt: (request.state?.request ?? '').trim(),
      activeModelId,
      activeTier: 'standard_coder',
      registeredTools: ['read_file', 'write_file', 'bash', 'edit'],
    };

    const response = await fetchImpl(`${endpoint.url}/hook/pre-turn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(preTurnPayload),
      signal,
    });

    if (!response.ok) {
      throw Object.assign(new Error(`Rev responded ${response.status}`), { status: response.status });
    }

    const data = await response.json();
    const complexityToCategory = {
      trivial_syntax: 'trivial',
      standard_feature: 'implement',
      complex_refactor: 'hard',
      architectural_plan: 'hard',
    };
    let choice = complexityToCategory[data?.complexity] ?? 'implement';
    const criteria = request.questions.category.criteria ?? {};
    if (criteria[data?.complexity]) {
      choice = data.complexity;
    } else if (!criteria[choice]) {
      const keys = Object.keys(criteria);
      if (keys.length > 0 && !keys.includes(choice)) {
        choice = keys[0];
      }
    }
    const confidence = data?.degraded ? 0.5 : 0.95;
    return {
      answers: {
        category: { choice, confidence },
      },
      // Surfaced to the caller so a non-escalating turn keeps the resident
      // model instead of re-switching it (KV-cache affinity, Rev PRD-01 4.1.2).
      retainActiveModel: data?.retainActiveModel === true,
      allowedTools: Array.isArray(data?.allowedTools) ? data.allowedTools : null,
      ms: Date.now() - started,
    };
  }

  // 2. Permission safety evaluation
  if (request.questions?.ask) {
    const perm = request.state?.permission ?? {};
    const metadataCommand = z.string().safeParse(perm.metadata?.command);
    const command = metadataCommand.success
      ? metadataCommand.data
      : Array.isArray(perm.patterns)
        ? perm.patterns.join(' ')
        : '';

    const evaluation = evaluateRevSafety(perm.type, command);
    return {
      answers: {
        ask: { noul: evaluation.score },
        kind: { choice: evaluation.kind },
      },
      ms: Date.now() - started,
    };
  }

  throw new Error('Rev received an unrecognised question type');
};

export const createJevClient = ({ fetchImpl = fetch, timeoutMs = JEV_TIMEOUT_MS, revUrl = REV_API_URL } = {}) => ({
  /** Resolves to the parsed answers; throws with `status` on an HTTP error and `code: 'timeout'` on abort. */
  ask: async (request, token) => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    const started = Date.now();
    let endpoint = null;
    try {
      endpoint = jevEndpoint(token, { revUrl });
      if (endpoint.source === 'rev-local') {
        return await askRev({ endpoint, request, fetchImpl, signal: abort.signal, started });
      }
      const response = await fetchImpl(endpoint.url, {
        method: 'POST',
        headers: { ...endpoint.headers, 'content-type': 'application/json' },
        body: JSON.stringify({ ...request, model: endpoint.model }),
        signal: abort.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw Object.assign(new Error(`Jev responded ${response.status}`), { status: response.status });
      }
      const body = responseSchema.safeParse(JSON.parse(text));
      if (!body.success) throw new Error('Jev response has no answers');
      return { answers: body.data.answers, ms: Date.now() - started };
    } catch (error) {
      if (error?.name === 'AbortError') {
        const label = endpoint?.source === 'rev-local' ? 'Rev' : 'Jev';
        throw Object.assign(new Error(`${label} timed out after ${timeoutMs}ms`), { code: 'timeout' });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  },
});

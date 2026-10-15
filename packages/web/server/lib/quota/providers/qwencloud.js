import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { readOpenCodeCredentials } from '../../opencode/auth.js';
import {
  buildResult,
  getAuthEntry,
  normalizeAuthEntry,
  toTimestamp,
  toUsageWindow,
} from '../utils/index.js';

export const providerId = 'alibaba-token-plan';
export const providerName = 'Qwen Cloud';
export const aliases = ['alibaba-token-plan', 'alibaba-token-plan-cn', 'qwencloud', 'qwen-cloud'];

export const isConfigured = (auth) => {
  const entry = normalizeAuthEntry(getAuthEntry(auth, aliases));
  if (entry?.key || entry?.token) return true;
  try {
    return existsSync(path.join(homedir(), '.qwencloud', 'credentials'));
  } catch {
    return false;
  }
};

const QwenWindowItemSchema = z.object({
  percent: z.number().optional(),
  used_pct: z.number().optional(),
  reset_at: z.union([z.string(), z.number()]).optional(),
  resetAt: z.union([z.string(), z.number()]).optional(),
  next_reset_at: z.union([z.string(), z.number()]).optional(),
});

const QwenCodingPlanSchema = z.object({
  windows: z.record(z.string(), z.object({
    used_pct: z.number().optional(),
    next_reset_at: z.union([z.string(), z.number()]).optional(),
  })).optional(),
});

const QwenTokenPlanSchema = z.object({
  subscribed: z.boolean().optional(),
  totalCredits: z.number().optional(),
  remainingCredits: z.number().optional(),
  usedPct: z.number().optional(),
  resetDate: z.union([z.string(), z.number()]).optional(),
});

const QwenFreeTierItemSchema = z.object({
  model_id: z.string(),
  quota: z.object({
    remaining: z.number().optional(),
    total: z.number().optional(),
    used_pct: z.number().optional(),
    resetDate: z.union([z.string(), z.number()]).optional(),
    unit: z.string().optional(),
  }),
});

const QwenPayloadSchema = z.object({
  usage: z.record(z.string(), QwenWindowItemSchema).optional(),
  coding_plan: QwenCodingPlanSchema.optional(),
  token_plan: QwenTokenPlanSchema.optional(),
  free_tier: z.array(QwenFreeTierItemSchema).optional(),
}).passthrough();

export const parseQwenCloudUsage = (rawPayload) => {
  const parsedResult = QwenPayloadSchema.safeParse(rawPayload);
  if (!parsedResult.success) {
    return { windows: {}, models: {} };
  }

  const payload = parsedResult.data;
  const windows = {};
  const models = {};

  if (payload.usage) {
    for (const [key, windowData] of Object.entries(payload.usage)) {
      const pct = windowData.percent ?? windowData.used_pct ?? null;
      const resetAt = toTimestamp(windowData.reset_at ?? windowData.resetAt ?? windowData.next_reset_at);
      if (pct !== null && Number.isFinite(pct)) {
        windows[key] = toUsageWindow({
          usedPercent: Math.min(100, Math.max(0, pct)),
          resetAt,
          windowSeconds: key === '5h' ? 5 * 3600 : key === 'weekly' ? 7 * 86400 : null,
        });
      }
    }
  }

  if (payload.coding_plan?.windows) {
    for (const [key, windowData] of Object.entries(payload.coding_plan.windows)) {
      const windowKey = key === 'per_5h' ? '5h' : key;
      const pct = windowData.used_pct ?? null;
      const resetAt = toTimestamp(windowData.next_reset_at);
      if (pct !== null && Number.isFinite(pct)) {
        windows[windowKey] = toUsageWindow({
          usedPercent: Math.min(100, Math.max(0, pct)),
          resetAt,
          windowSeconds: windowKey === '5h' ? 5 * 3600 : windowKey === 'weekly' ? 7 * 86400 : null,
        });
      }
    }
  }

  if (payload.token_plan && (payload.token_plan.totalCredits ?? 0) > 0) {
    const tp = payload.token_plan;
    const pct = tp.usedPct ?? 0;
    const resetAt = toTimestamp(tp.resetDate);
    const remaining = tp.remainingCredits ?? 0;
    const total = tp.totalCredits ?? 0;
    windows.credits = toUsageWindow({
      usedPercent: Math.min(100, Math.max(0, pct)),
      resetAt,
      windowSeconds: null,
      valueLabel: `${remaining.toLocaleString()} / ${total.toLocaleString()} Credits`,
    });
  }

  if (payload.free_tier && payload.free_tier.length > 0) {
    let totalTokens = 0;
    let remainingTokens = 0;
    let nearestResetAt = null;

    for (const item of payload.free_tier) {
      const q = item.quota;
      const resetAt = toTimestamp(q.resetDate);
      if (resetAt && (!nearestResetAt || resetAt < nearestResetAt)) {
        nearestResetAt = resetAt;
      }

      if (q.unit === 'tokens') {
        totalTokens += (q.total ?? 0);
        remainingTokens += (q.remaining ?? 0);
      }

      const remaining = q.remaining ?? 0;
      const total = q.total ?? 0;
      models[item.model_id] = {
        windows: {
          quota: toUsageWindow({
            usedPercent: q.used_pct ?? 0,
            resetAt,
            windowSeconds: null,
            valueLabel: `${remaining.toLocaleString()} / ${total.toLocaleString()} ${q.unit ?? 'tokens'}`,
          }),
        },
      };
    }

    if (totalTokens > 0 && Object.keys(windows).length === 0) {
      const usedTokens = totalTokens - remainingTokens;
      const usedPercent = Math.min(100, Math.max(0, (usedTokens / totalTokens) * 100));
      windows.tokens = toUsageWindow({
        usedPercent,
        resetAt: nearestResetAt,
        windowSeconds: null,
        valueLabel: `${remainingTokens.toLocaleString()} / ${totalTokens.toLocaleString()} tokens`,
      });
    }
  }

  return { windows, models };
};

export const fetchQwenCloudCliUsage = async (execImpl = execFileSync) => {
  const binary = process.platform === 'win32' ? 'qwencloud.cmd' : 'qwencloud';
  const stdout = execImpl(binary, ['usage', 'summary', '--format', 'json'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const data = JSON.parse(stdout);
  return parseQwenCloudUsage(data);
};

export const fetchQuota = async (execImpl = execFileSync) => {
  try {
    const auth = await readOpenCodeCredentials().catch(() => ({}));
    if (!isConfigured(auth)) {
      return buildResult({ providerId, providerName, ok: false, configured: false, error: 'Not configured' });
    }

    const { windows, models } = await fetchQwenCloudCliUsage(execImpl);
    if (Object.keys(windows).length === 0 && Object.keys(models).length === 0) {
      return buildResult({ providerId, providerName, ok: false, configured: true, error: 'No usage reported' });
    }

    return buildResult({
      providerId,
      providerName,
      ok: true,
      configured: true,
      usage: {
        windows,
        models,
      },
    });
  } catch (error) {
    return buildResult({
      providerId,
      providerName,
      ok: false,
      configured: true,
      error: error instanceof Error ? error.message : 'Failed to query Qwen Cloud usage',
    });
  }
};

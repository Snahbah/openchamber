import { execFileSync } from 'node:child_process';
import { z } from 'zod';

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

export const QwenPayloadSchema = z.object({
  usage: z.record(z.string(), QwenWindowItemSchema).optional(),
  coding_plan: QwenCodingPlanSchema.optional(),
  token_plan: QwenTokenPlanSchema.optional(),
  free_tier: z.array(QwenFreeTierItemSchema).optional(),
}).passthrough();

export type QwenPayload = z.infer<typeof QwenPayloadSchema>;

const TimestampInputSchema = z.union([z.string(), z.number()]);

const toTimestamp = (value: z.infer<typeof TimestampInputSchema> | undefined): number | null => {
  if (value === undefined) return null;
  const numResult = z.number().safeParse(value);
  if (numResult.success) {
    return numResult.data < 1_000_000_000_000 ? numResult.data * 1000 : numResult.data;
  }
  const strResult = z.string().safeParse(value);
  if (strResult.success) {
    const parsed = Date.parse(strResult.data);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
};

export type WindowResult = {
  usedPercent: number | null;
  remainingPercent: number | null;
  windowSeconds: number | null;
  resetAfterSeconds: number | null;
  resetAt: number | null;
  resetAtFormatted: string | null;
  resetAfterFormatted: string | null;
  valueLabel?: string;
};

export type QwenCloudQuotaResult = {
  windows: Record<string, WindowResult>;
  models: Record<string, { windows: Record<string, WindowResult> }>;
};

const toWindow = (usedPercent: number, resetAt: number | null, valueLabel?: string): WindowResult => {
  const clampedUsed = Math.min(100, Math.max(0, usedPercent));
  const res: WindowResult = {
    usedPercent: clampedUsed,
    remainingPercent: Math.max(0, 100 - clampedUsed),
    windowSeconds: null,
    resetAfterSeconds: resetAt ? Math.max(0, Math.floor((resetAt - Date.now()) / 1000)) : null,
    resetAt,
    resetAtFormatted: null,
    resetAfterFormatted: null,
  };
  if (valueLabel) {
    res.valueLabel = valueLabel;
  }
  return res;
};

export const parseQwenCloudPayload = (rawPayload: QwenPayload): QwenCloudQuotaResult => {
  const payload = QwenPayloadSchema.parse(rawPayload);
  const windows: Record<string, WindowResult> = {};
  const models: Record<string, { windows: Record<string, WindowResult> }> = {};

  if (payload.usage) {
    for (const [key, windowData] of Object.entries(payload.usage)) {
      const pct = windowData.percent ?? windowData.used_pct ?? null;
      const resetAt = toTimestamp(windowData.reset_at ?? windowData.resetAt ?? windowData.next_reset_at);
      if (pct !== null && Number.isFinite(pct)) {
        windows[key] = toWindow(pct, resetAt);
      }
    }
  }

  if (payload.coding_plan?.windows) {
    for (const [key, windowData] of Object.entries(payload.coding_plan.windows)) {
      const windowKey = key === 'per_5h' ? '5h' : key;
      const pct = windowData.used_pct ?? null;
      const resetAt = toTimestamp(windowData.next_reset_at);
      if (pct !== null && Number.isFinite(pct)) {
        windows[windowKey] = toWindow(pct, resetAt);
      }
    }
  }

  if (payload.token_plan && (payload.token_plan.totalCredits ?? 0) > 0) {
    const tp = payload.token_plan;
    const pct = tp.usedPct ?? 0;
    const resetAt = toTimestamp(tp.resetDate);
    const rem = tp.remainingCredits ?? 0;
    const tot = tp.totalCredits ?? 0;
    windows.credits = toWindow(pct, resetAt, `${rem.toLocaleString()} / ${tot.toLocaleString()} Credits`);
  }

  if (payload.free_tier && payload.free_tier.length > 0) {
    let totalTokens = 0;
    let remainingTokens = 0;
    let nearestResetAt: number | null = null;

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

      const rem = q.remaining ?? 0;
      const tot = q.total ?? 0;
      const pct = q.used_pct ?? 0;
      models[item.model_id] = {
        windows: {
          quota: toWindow(pct, resetAt, `${rem.toLocaleString()} / ${tot.toLocaleString()} ${q.unit ?? 'tokens'}`),
        },
      };
    }

    if (totalTokens > 0 && Object.keys(windows).length === 0) {
      const usedTokens = totalTokens - remainingTokens;
      const usedPercent = Math.min(100, Math.max(0, (usedTokens / totalTokens) * 100));
      windows.tokens = toWindow(
        usedPercent,
        nearestResetAt,
        `${remainingTokens.toLocaleString()} / ${totalTokens.toLocaleString()} tokens`,
      );
    }
  }

  return { windows, models };
};

export const fetchQwenCloudUsage = async (execImpl = execFileSync): Promise<QwenCloudQuotaResult> => {
  const binary = process.platform === 'win32' ? 'qwencloud.cmd' : 'qwencloud';
  const stdout = execImpl(binary, ['usage', 'summary', '--format', 'json'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const data = QwenPayloadSchema.parse(JSON.parse(stdout));
  return parseQwenCloudPayload(data);
};

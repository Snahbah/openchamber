/**
 * Google Provider - Transforms
 *
 * Data transformation functions for Google quota responses.
 * @module quota/providers/google/transforms
 */

import {
  asNonEmptyString,
  toNumber,
  toTimestamp,
  toUsageWindow
} from '../../utils/index.js';

const GOOGLE_FIVE_HOUR_WINDOW_SECONDS = 5 * 60 * 60;
const GOOGLE_DAILY_WINDOW_SECONDS = 24 * 60 * 60;
const GOOGLE_WEEKLY_WINDOW_SECONDS = 7 * 24 * 60 * 60;

export const parseGoogleRefreshToken = (rawRefreshToken) => {
  const refreshToken = asNonEmptyString(rawRefreshToken);
  if (!refreshToken) {
    return { refreshToken: null, projectId: null, managedProjectId: null };
  }

  const [rawToken = '', rawProject = '', rawManagedProject = ''] = refreshToken.split('|');
  return {
    refreshToken: asNonEmptyString(rawToken),
    projectId: asNonEmptyString(rawProject),
    managedProjectId: asNonEmptyString(rawManagedProject)
  };
};

const resolveGoogleWindow = (sourceId, resetAt) => {
  if (sourceId === 'gemini') {
    return { label: 'daily', seconds: GOOGLE_DAILY_WINDOW_SECONDS };
  }

  if (sourceId === 'antigravity') {
    const remainingSeconds = typeof resetAt === 'number'
      ? Math.max(0, Math.round((resetAt - Date.now()) / 1000))
      : null;

    if (remainingSeconds !== null && remainingSeconds > 10 * 60 * 60) {
      return { label: 'daily', seconds: GOOGLE_DAILY_WINDOW_SECONDS };
    }

    return { label: '5h', seconds: GOOGLE_FIVE_HOUR_WINDOW_SECONDS };
  }

  return { label: 'daily', seconds: GOOGLE_DAILY_WINDOW_SECONDS };
};

export const transformQuotaBucket = (bucket, sourceId) => {
  const modelId = asNonEmptyString(bucket?.modelId);
  if (!modelId) {
    return null;
  }

  const scopedName = modelId.startsWith(`${sourceId}/`)
    ? modelId
    : `${sourceId}/${modelId}`;

  const remainingFraction = toNumber(bucket?.remainingFraction);
  const remainingPercent = remainingFraction !== null
    ? Math.round(remainingFraction * 100)
    : null;
  const usedPercent = remainingPercent !== null ? Math.max(0, 100 - remainingPercent) : null;
  const resetAt = toTimestamp(bucket?.resetTime);
  const window = resolveGoogleWindow(sourceId, resetAt);

  return {
    [scopedName]: {
      windows: {
        [window.label]: toUsageWindow({
          usedPercent,
          windowSeconds: window.seconds,
          resetAt
        })
      }
    }
  };
};

/**
 * Account-level usage from v1internal:retrieveUserQuotaSummary.
 *
 * The summary reports pools, not models: each group carries one bucket per window
 * (`weekly` or `5h`). Only the FIRST group that yields usable buckets becomes the
 * provider-level windows — the panel renders Agy exactly like Claude, as simple
 * 5h/7d bars. Further groups (for example a separate third-party `Claude and GPT models`
 * pool) are intentionally NOT surfaced as rows: they were rendered like model rows,
 * which is the per-model noise this provider is meant to avoid.
 *
 * A bucket is only usable when it carries both a finite remaining fraction and a parseable
 * reset time — the panel's window contract requires a number and two formatted strings, and a
 * null in any of those positions is a validation failure rather than a missing bar.
 */
export const toGoogleSummaryUsage = (groups) => {
  const windows = {};

  for (const group of Array.isArray(groups) ? groups : []) {
    const groupWindows = {};

    for (const bucket of Array.isArray(group?.buckets) ? group.buckets : []) {
      const remainingFraction = toNumber(bucket?.remainingFraction);
      const resetAt = toTimestamp(bucket?.resetTime);
      if (remainingFraction === null || resetAt === null) continue;

      const isWeekly = bucket?.window === 'weekly';
      groupWindows[isWeekly ? '7d' : '5h'] = toUsageWindow({
        usedPercent: Math.max(0, Math.min(100, (1 - remainingFraction) * 100)),
        windowSeconds: isWeekly ? GOOGLE_WEEKLY_WINDOW_SECONDS : GOOGLE_FIVE_HOUR_WINDOW_SECONDS,
        resetAt
      });
    }

    if (!Object.keys(groupWindows).length) continue;

    Object.assign(windows, groupWindows);
    break;
  }

  return { windows, models: {} };
};

export const transformModelData = (modelName, modelData, sourceId) => {
  const scopedName = modelName.startsWith(`${sourceId}/`)
    ? modelName
    : `${sourceId}/${modelName}`;

  const remainingFraction = modelData?.quotaInfo?.remainingFraction;
  const remainingPercent = typeof remainingFraction === 'number'
    ? Math.round(remainingFraction * 100)
    : null;
  const usedPercent = remainingPercent !== null ? Math.max(0, 100 - remainingPercent) : null;
  const resetAt = modelData?.quotaInfo?.resetTime
    ? new Date(modelData.quotaInfo.resetTime).getTime()
    : null;
  const window = resolveGoogleWindow(sourceId, resetAt);

  return {
    [scopedName]: {
      windows: {
        [window.label]: toUsageWindow({
          usedPercent,
          windowSeconds: window.seconds,
          resetAt
        })
      }
    }
  };
};

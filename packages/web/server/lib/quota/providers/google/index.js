/**
 * Google Provider - quota reader.
 *
 * Antigravity publishes two quota shapes. `fetchAvailableModels` reports one window per model,
 * which is why the panel rendered a row per model and never a weekly figure.
 * `retrieveUserQuotaSummary` reports pools: one bucket per window per group. This module prefers
 * the summary for Antigravity accounts, and keeps the model-level path for Gemini accounts,
 * which is the shape that source is known to serve.
 *
 * Dependencies are injected so the reader can be exercised without replacing modules or reaching
 * the network; production callers use the defaults.
 *
 * @module quota/providers/google
 */

import { buildResult, toNumber } from '../../utils/index.js';
import {
  resolveGoogleAuthSources,
  resolveGoogleOAuthClient,
  DEFAULT_PROJECT_ID
} from './auth.js';
import { transformQuotaBucket, transformModelData, toGoogleSummaryUsage } from './transforms.js';
import {
  refreshGoogleAccessToken,
  fetchGoogleQuotaBuckets,
  fetchGoogleModels,
  fetchGoogleQuotaSummary
} from './api.js';

export { resolveGoogleAuthSources } from './auth.js';

export const providerId = 'google';
export const providerName = 'Agy';
export const aliases = ['google', 'google.oauth'];

export const isConfigured = () => resolveGoogleAuthSources().length > 0;

const describeSummaryFailure = (sourceLabel, status) => {
  if (status === 401 || status === 403) {
    return `${sourceLabel}: not authorised for Cloud Code quota`;
  }
  if (status === 0) {
    return `${sourceLabel}: quota request failed`;
  }
  return `${sourceLabel}: quota request failed (${status})`;
};

const fetchAntigravityUsage = async (accessToken, projectId, sourceLabel, { fetchImpl }) => {
  const result = await fetchGoogleQuotaSummary(accessToken, projectId, { fetchImpl });

  if (!result.ok) {
    return { error: describeSummaryFailure(sourceLabel, result.status), usage: null };
  }

  const { windows, models } = toGoogleSummaryUsage(result.payload?.groups);
  if (!Object.keys(windows).length && !Object.keys(models).length) {
    return { error: `${sourceLabel}: quota summary carried no usable windows`, usage: null };
  }

  return { error: null, usage: { windows, models } };
};

export const fetchGoogleQuota = async ({
  readAuthSources = resolveGoogleAuthSources,
  refreshAccessToken = refreshGoogleAccessToken,
  fetchImpl = fetch
} = {}) => {
  const authSources = readAuthSources();
  if (!authSources.length) {
    return buildResult({
      providerId,
      providerName,
      ok: false,
      configured: false,
      error: 'Not configured'
    });
  }

  const windows = {};
  const models = {};
  const sourceErrors = [];
  let mergedAnyUsage = false;

  for (const source of authSources) {
    let accessToken = source.accessToken;
    const expires = toNumber(source.expires);
    const isExpired = expires !== null && expires <= Date.now();

    if (!accessToken || isExpired) {
      if (!source.refreshToken) {
        sourceErrors.push(`${source.sourceLabel}: missing refresh token`);
        continue;
      }
      const { clientId, clientSecret } = resolveGoogleOAuthClient(source.sourceId);
      accessToken = await refreshAccessToken(source.refreshToken, clientId, clientSecret);
    }

    if (!accessToken) {
      sourceErrors.push(`${source.sourceLabel}: failed to refresh OAuth token`);
      continue;
    }

    const projectId = source.projectId ?? DEFAULT_PROJECT_ID;

    if (source.sourceId === 'antigravity') {
      const { error, usage } = await fetchAntigravityUsage(accessToken, projectId, source.sourceLabel, {
        fetchImpl
      });
      if (error) {
        sourceErrors.push(error);
        continue;
      }
      Object.assign(windows, usage.windows);
      Object.assign(models, usage.models);
      mergedAnyUsage = true;
      continue;
    }

    const quotaPayload = await fetchGoogleQuotaBuckets(accessToken, projectId);
    const buckets = Array.isArray(quotaPayload?.buckets) ? quotaPayload.buckets : [];

    for (const bucket of buckets) {
      const transformed = transformQuotaBucket(bucket, source.sourceId);
      if (transformed) {
        Object.assign(models, transformed);
        mergedAnyUsage = true;
      }
    }

    const payload = await fetchGoogleModels(accessToken, projectId);
    for (const [modelName, modelData] of Object.entries(payload?.models ?? {})) {
      Object.assign(models, transformModelData(modelName, modelData, source.sourceId));
      mergedAnyUsage = true;
    }
  }

  if (!mergedAnyUsage) {
    return buildResult({
      providerId,
      providerName,
      ok: false,
      configured: true,
      error: sourceErrors[0] ?? 'Failed to fetch quota'
    });
  }

  return buildResult({
    providerId,
    providerName,
    ok: true,
    configured: true,
    usage: { windows, models }
  });
};

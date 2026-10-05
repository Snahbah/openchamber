import { readOpenCodeCredentials } from '../../opencode/auth.js';
import {
  getAuthEntry,
  normalizeAuthEntry,
  buildResult,
  toUsageWindow,
  formatMoney,
  asObject,
  asNonEmptyString
} from '../utils/index.js';

export const providerId = 'moonshotai';
export const providerName = 'Moonshot AI';
const aliases = ['moonshotai'];
const MOONSHOT_BALANCE_URL = 'https://api.moonshot.ai/v1/users/me/balance';

const getApiKey = (auth) => {
  const entry = normalizeAuthEntry(getAuthEntry(auth, aliases));
  return asNonEmptyString(entry?.key) ?? asNonEmptyString(entry?.token);
};

export const isConfigured = (auth) => Boolean(getApiKey(auth));

/**
 * The pay-as-you-go balance behind a Moonshot platform key, as usage windows.
 * Resolves to `{ windows }` on success or `{ status, error }` on failure; never throws.
 * Shared with the Kimi provider, whose users often hold a platform key rather than a
 * Kimi Code subscription key.
 */
export const fetchMoonshotBalance = async (apiKey, { fetchImpl = fetch } = {}) => {
  const timeoutSignal = AbortSignal.timeout(15_000);

  try {
    const response = await fetchImpl(MOONSHOT_BALANCE_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: timeoutSignal
    });

    if (!response.ok) {
      return {
        status: response.status,
        error: response.status === 401 || response.status === 403
          ? 'Session expired — please re-authenticate with Moonshot AI'
          : `API error: ${response.status}`
      };
    }

    // The international platform (api.moonshot.ai) bills in USD. The balance is
    // what remains (cash plus vouchers); the API reports no spent figure.
    const balance = asObject(asObject(await response.json())?.data)?.available_balance;
    if (!Number.isFinite(balance)) {
      return { status: response.status, error: 'No quota data in response' };
    }

    return {
      windows: {
        credits_balance: toUsageWindow({
          usedPercent: null,
          windowSeconds: null,
          resetAt: null,
          valueLabel: `$${formatMoney(balance)}`
        })
      }
    };
  } catch (error) {
    const isTimeout = error instanceof DOMException && (
      error.name === 'TimeoutError' || (error.name === 'AbortError' && timeoutSignal.aborted)
    );
    const isParseError = error instanceof SyntaxError;
    return {
      status: 0,
      error: isTimeout
        ? 'Request timed out'
        : isParseError
          ? 'Invalid response from provider'
          : (error instanceof Error ? error.message : 'Request failed')
    };
  }
};

export const fetchQuota = async ({ readAuth = readOpenCodeCredentials, fetchImpl = fetch } = {}) => {
  const apiKey = getApiKey(await readAuth());

  if (!apiKey) {
    return buildResult({ providerId, providerName, ok: false, configured: false, error: 'Not configured' });
  }

  const { windows, error } = await fetchMoonshotBalance(apiKey, { fetchImpl });
  if (!windows) {
    return buildResult({ providerId, providerName, ok: false, configured: true, error });
  }

  return buildResult({ providerId, providerName, ok: true, configured: true, usage: { windows } });
};

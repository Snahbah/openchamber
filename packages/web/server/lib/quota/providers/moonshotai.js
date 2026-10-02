import { readAuthFile } from '../../opencode/auth.js';
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

export const isConfigured = (auth = readAuthFile()) => Boolean(getApiKey(auth));

export const fetchQuota = async ({ readAuth = readAuthFile, fetchImpl = fetch } = {}) => {
  const apiKey = getApiKey(readAuth());

  if (!apiKey) {
    return buildResult({ providerId, providerName, ok: false, configured: false, error: 'Not configured' });
  }

  const timeoutSignal = AbortSignal.timeout(15_000);

  try {
    const response = await fetchImpl(MOONSHOT_BALANCE_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: timeoutSignal
    });

    if (!response.ok) {
      return buildResult({
        providerId,
        providerName,
        ok: false,
        configured: true,
        error: response.status === 401 || response.status === 403
          ? 'Session expired — please re-authenticate with Moonshot AI'
          : `API error: ${response.status}`
      });
    }

    // The international platform (api.moonshot.ai) bills in USD. The balance is
    // what remains (cash plus vouchers); the API reports no spent figure.
    const balance = asObject(asObject(await response.json())?.data)?.available_balance;
    if (!Number.isFinite(balance)) {
      return buildResult({ providerId, providerName, ok: false, configured: true, error: 'No quota data in response' });
    }

    const windows = {
      credits_balance: toUsageWindow({
        usedPercent: null,
        windowSeconds: null,
        resetAt: null,
        valueLabel: `$${formatMoney(balance)}`
      })
    };

    return buildResult({ providerId, providerName, ok: true, configured: true, usage: { windows } });
  } catch (error) {
    const isTimeout = error instanceof DOMException && (
      error.name === 'TimeoutError' || (error.name === 'AbortError' && timeoutSignal.aborted)
    );
    const isParseError = error instanceof SyntaxError;
    return buildResult({
      providerId,
      providerName,
      ok: false,
      configured: true,
      error: isTimeout
        ? 'Request timed out'
        : isParseError
          ? 'Invalid response from provider'
          : (error instanceof Error ? error.message : 'Request failed')
    });
  }
};

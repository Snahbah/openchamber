import { existsSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { readManagedCredential, writeManagedCredential } from '../credentials/providers.js';
import {
  buildResult,
  formatMoney,
  toNumber,
  toTimestamp,
  toUsageWindow,
  getAuthEntry,
  normalizeAuthEntry,
  readJsonFile
} from '../utils/index.js';

const BASE_URL = 'https://api2.cursor.sh';
const USAGE_URL = `${BASE_URL}/aiserver.v1.DashboardService/GetCurrentPeriodUsage`;
const PLAN_URL = `${BASE_URL}/aiserver.v1.DashboardService/GetPlanInfo`;
const CREDITS_URL = `${BASE_URL}/aiserver.v1.DashboardService/GetCreditGrantsBalance`;
const REFRESH_URL = `${BASE_URL}/oauth/token`;
const CLIENT_ID = 'KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB';
const REFRESH_BUFFER_MS = 5 * 60 * 1000;
const STATE_DB_CANDIDATES = [
  join(homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb'),
  join(homedir(), 'AppData', 'Roaming', 'Cursor', 'User', 'globalStorage', 'state.vscdb'),
  join(homedir(), '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb')
];

const getStateDbPath = () => STATE_DB_CANDIDATES.find((p) => existsSync(p)) || STATE_DB_CANDIDATES[0];

export const providerId = 'cursor';
export const providerName = 'Cursor';
const aliases = ['cursor', 'cursor.oauth'];

const readJwtPayload = (token) => {
  try {
    const [, payload] = String(token).split('.');
    if (!payload) return null;
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
};

const readStateValue = (key) => {
  const dbPath = getStateDbPath();
  if (!existsSync(dbPath)) return null;
  try {
    const escapedKey = String(key).replace(/'/g, "''");
    const rows = execFileSync('sqlite3', [
      '-json',
      dbPath,
      `SELECT value FROM ItemTable WHERE key = '${escapedKey}' LIMIT 1;`
    ], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const parsed = JSON.parse(rows || '[]');
    const value = parsed?.[0]?.value;
    if (typeof value === 'string' && value.trim()) return value.trim();
  } catch {}

  try {
    const pythonCode = 'import sqlite3, sys; conn = sqlite3.connect(sys.argv[1]); c = conn.cursor(); c.execute("SELECT value FROM ItemTable WHERE key = ? LIMIT 1", (sys.argv[2],)); r = c.fetchone(); print(r[0] if r and r[0] else "")';
    const res = execFileSync('python', ['-c', pythonCode, dbPath, String(key)], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const value = res?.trim();
    if (value) return value;
  } catch {}

  return null;
};

const readFileToken = (path) => {
  try {
    if (!path || !existsSync(path)) return null;
    const content = readFileSync(path, 'utf8').trim();
    return content || null;
  } catch {
    return null;
  }
};

const readOpenCodeAuth = () => {
  try {
    const authPath = join(homedir(), '.local', 'share', 'opencode', 'auth.json');
    const authData = readJsonFile(authPath);
    const entry = authData?.cursor;
    const accessToken = typeof entry?.access === 'string' ? entry.access.trim() : (typeof entry?.token === 'string' ? entry.token.trim() : null);
    const refreshToken = typeof entry?.refresh === 'string' ? entry.refresh.trim() : null;
    if (accessToken || refreshToken) {
      return { accessToken, refreshToken, source: 'opencode' };
    }
  } catch {}
  return null;
};

const loadAuthState = (auth) => {
  const envAccessToken = process.env.CURSOR_TOKEN || process.env.CURSOR_ACCESS_TOKEN || null;
  const envRefreshToken = process.env.CURSOR_REFRESH_TOKEN || null;
  const accessTokenPath = process.env.CURSOR_TOKEN_FILE || null;
  const refreshTokenPath = process.env.CURSOR_REFRESH_TOKEN_FILE || null;
  const fileAccessToken = readFileToken(accessTokenPath);
  const fileRefreshToken = readFileToken(refreshTokenPath);

  if (envAccessToken || envRefreshToken) {
    return {
      accessToken: envAccessToken,
      refreshToken: envRefreshToken,
      source: 'env'
    };
  }

  if (fileAccessToken || fileRefreshToken) {
    return {
      accessToken: fileAccessToken,
      refreshToken: fileRefreshToken,
      source: 'file'
    };
  }

  const managed = readManagedCredential(providerId);
  if (managed?.accessToken || managed?.refreshToken) {
    return {
      accessToken: managed?.accessToken || null,
      refreshToken: managed?.refreshToken || null,
      source: 'managed'
    };
  }

  if (auth) {
    const entry = normalizeAuthEntry(getAuthEntry(auth, aliases));
    const token = entry?.access || entry?.token;
    if (token || entry?.refresh) {
      return {
        accessToken: token || null,
        refreshToken: entry?.refresh || null,
        source: 'opencode'
      };
    }
  }

  const opencodeAuth = readOpenCodeAuth();
  if (opencodeAuth) {
    return opencodeAuth;
  }

  const stateAccessToken = readStateValue('cursorAuth/accessToken');
  const stateRefreshToken = readStateValue('cursorAuth/refreshToken');
  if (stateAccessToken || stateRefreshToken) {
    return {
      accessToken: stateAccessToken,
      refreshToken: stateRefreshToken,
      source: 'state_db'
    };
  }

  return {
    accessToken: null,
    refreshToken: null,
    source: 'none'
  };
};

const tokenNeedsRefresh = (token) => {
  if (!token) return true;
  const payload = readJwtPayload(token);
  const expiresAt = typeof payload?.exp === 'number' ? payload.exp * 1000 : null;
  return !expiresAt || expiresAt - Date.now() <= REFRESH_BUFFER_MS;
};

const persistAccessToken = (auth, accessToken) => {
  if (auth.source === 'managed') {
    writeManagedCredential(providerId, { accessToken, refreshToken: auth.refreshToken || '' });
  } else if (auth.source === 'opencode') {
    try {
      const authPath = join(homedir(), '.local', 'share', 'opencode', 'auth.json');
      if (existsSync(authPath)) {
        const content = JSON.parse(readFileSync(authPath, 'utf8'));
        if (content.cursor) {
          content.cursor.access = accessToken;
          writeFileSync(authPath, `${JSON.stringify(content, null, 2)}\n`, 'utf8');
        }
      }
    } catch {}
  }
};

export const importCursorCredential = async () => {
  let accessToken = readStateValue('cursorAuth/accessToken') || '';
  let refreshToken = readStateValue('cursorAuth/refreshToken') || '';

  if (!accessToken && !refreshToken) {
    const opencodeAuth = readOpenCodeAuth();
    if (opencodeAuth) {
      accessToken = opencodeAuth.accessToken || '';
      refreshToken = opencodeAuth.refreshToken || '';
    }
  }

  const credential = { accessToken, refreshToken };
  if (!credential.accessToken && !credential.refreshToken) throw new Error('Cursor credentials are unavailable');
  const resolvedToken = await resolveCredentialAccessToken({ ...credential, source: 'import' });
  if (!resolvedToken) throw new Error('Cursor credentials are invalid');
  return writeManagedCredential(providerId, { ...credential, accessToken: resolvedToken });
};

const refreshAccessToken = async (auth) => {
  if (!auth.refreshToken) return auth.accessToken;

  const response = await fetch(REFRESH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: auth.refreshToken
    })
  });

  const body = await response.json().catch(() => null);
  if (body?.shouldLogout === true) {
    throw new Error('Session expired - please sign in to Cursor again');
  }
  if (!response.ok) {
    throw new Error(response.status === 401 ? 'Cursor session expired' : `API error: ${response.status}`);
  }
  if (typeof body?.access_token !== 'string' || !body.access_token) {
    throw new Error('Cursor refresh response did not include an access token');
  }

  persistAccessToken(auth, body.access_token);
  return body.access_token;
};

const resolveCredentialAccessToken = async (auth) => {
  if (!auth.accessToken && !auth.refreshToken) return null;
  if (!tokenNeedsRefresh(auth.accessToken)) return auth.accessToken;
  return refreshAccessToken(auth);
};

const resolveAccessToken = async () => resolveCredentialAccessToken(loadAuthState());

export const validateCursorCredential = async (credential) => {
  const accessToken = await resolveCredentialAccessToken({ ...credential, source: 'validation' });
  if (!accessToken) throw new Error('Cursor credentials are invalid');
  await connectPost(USAGE_URL, accessToken);
};

const connectPost = async (url, accessToken) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Connect-Protocol-Version': '1'
    },
    body: '{}'
  });

  if (!response.ok) {
    throw new Error(response.status === 401 ? 'Cursor session expired' : `API error: ${response.status}`);
  }

  return response.json();
};

const centsLabel = (cents) => {
  const value = toNumber(cents);
  return value === null ? null : `$${formatMoney(value / 100)}`;
};

const percentFromSpend = (planUsage) => {
  const explicit = toNumber(planUsage?.totalPercentUsed);
  if (explicit !== null) return explicit;
  const limit = toNumber(planUsage?.limit);
  const remaining = toNumber(planUsage?.remaining);
  if (!limit || remaining === null) return null;
  return Math.min(100, Math.max(0, ((limit - remaining) / limit) * 100));
};

const buildWindows = (usage, plan) => {
  const planUsage = usage?.planUsage ?? {};
  const spendLimitUsage = usage?.spendLimitUsage ?? {};
  const resetAt = toTimestamp(usage?.billingCycleEnd ?? plan?.planInfo?.billingCycleEnd);
  const windowSeconds = resetAt ? Math.max(0, Math.floor((resetAt - Date.now()) / 1000)) : null;
  const windows = {};

  windows.billing_cycle = toUsageWindow({
    usedPercent: percentFromSpend(planUsage),
    windowSeconds,
    resetAt,
    valueLabel: centsLabel(planUsage.totalSpend)
  });

  const autoPercent = toNumber(planUsage.autoPercentUsed);
  if (autoPercent !== null) {
    windows.auto = toUsageWindow({ usedPercent: autoPercent, windowSeconds, resetAt });
  }

  const apiPercent = toNumber(planUsage.apiPercentUsed);
  if (apiPercent !== null) {
    windows.api = toUsageWindow({ usedPercent: apiPercent, windowSeconds, resetAt });
  }

  const planLimit = centsLabel(planUsage.limit);
  if (planLimit) {
    const limit = toNumber(planUsage.limit);
    const remaining = toNumber(planUsage.remaining);
    windows.plan_limit = toUsageWindow({
      usedPercent: limit && remaining !== null
        ? Math.min(100, Math.max(0, ((limit - remaining) / limit) * 100))
        : null,
      windowSeconds,
      resetAt,
      valueLabel: `${centsLabel(planUsage.remaining) ?? '$0.00'} remaining of ${planLimit}`
    });
  }

  const onDemandLimit = toNumber(spendLimitUsage.individualLimit) ?? toNumber(spendLimitUsage.pooledLimit);
  if (onDemandLimit && onDemandLimit > 0) {
    const remaining = toNumber(spendLimitUsage.individualRemaining) ?? toNumber(spendLimitUsage.pooledRemaining) ?? 0;
    windows.on_demand = toUsageWindow({
      usedPercent: Math.min(100, Math.max(0, ((onDemandLimit - remaining) / onDemandLimit) * 100)),
      windowSeconds,
      resetAt,
      valueLabel: `${centsLabel(remaining) ?? '$0.00'} remaining of ${centsLabel(onDemandLimit)}`
    });
  }

  return windows;
};

const appendCreditsWindow = (windows, credits) => {
  const balance = toNumber(credits?.balanceCents ?? credits?.totalBalanceCents ?? credits?.amountCents);
  if (balance === null) return;
  windows.credits = toUsageWindow({
    usedPercent: null,
    windowSeconds: null,
    resetAt: null,
    valueLabel: centsLabel(balance)
  });
};

export const isConfigured = (auth) => {
  if (auth) {
    const entry = normalizeAuthEntry(getAuthEntry(auth, aliases));
    if (entry?.access || entry?.token || entry?.refresh) return true;
  }
  const authState = loadAuthState(auth);
  return Boolean(authState.accessToken || authState.refreshToken);
};

export const fetchQuota = async () => {
  const accessToken = await resolveAccessToken();
  if (!accessToken) {
    return buildResult({
      providerId,
      providerName,
      ok: false,
      configured: false,
      error: 'Not configured'
    });
  }

  try {
    const [usage, plan, credits] = await Promise.all([
      connectPost(USAGE_URL, accessToken),
      connectPost(PLAN_URL, accessToken).catch(() => null),
      connectPost(CREDITS_URL, accessToken).catch(() => null)
    ]);

    const windows = usage?.planUsage ? buildWindows(usage, plan) : {};
    appendCreditsWindow(windows, credits);

    if (Object.keys(windows).length === 0) {
      if (usage?.displayMessage) {
        windows.status = toUsageWindow({
          usedPercent: null,
          windowSeconds: null,
          resetAt: null,
          valueLabel: usage.displayMessage
        });
      } else if (usage?.enabled === false) {
        return buildResult({
          providerId,
          providerName,
          ok: false,
          configured: true,
          error: 'No active Cursor subscription'
        });
      }
    }

    return buildResult({
      providerId,
      providerName: plan?.planInfo?.planName ? `Cursor ${plan.planInfo.planName}` : providerName,
      ok: true,
      configured: true,
      usage: { windows }
    });
  } catch (error) {
    return buildResult({
      providerId,
      providerName,
      ok: false,
      configured: true,
      error: error instanceof Error ? error.message : 'Request failed'
    });
  }
};

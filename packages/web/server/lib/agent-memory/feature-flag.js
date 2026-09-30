/**
 * Whether agent memory exists at all in this build.
 *
 * The feature is complete but not released: it ships dark so it can be tested
 * against real work without appearing to users who have not asked for it. With
 * the flag unset there is no tool, no routes, no session index and no settings
 * row — not a switch left in the off position, which would invite someone to
 * turn on something unannounced.
 *
 * Read per call rather than captured at import, so a process started with the
 * variable set is the only thing that decides — no build step bakes it in.
 */

import fs from 'node:fs';
import path from 'node:path';

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

export const readStartupEnvValue = () => {
  try {
    const startupPath = path.join(
      process.env.USERPROFILE || process.env.HOME || '.',
      '.config',
      'openchamber',
      'startup.env',
    );
    if (!fs.existsSync(startupPath)) return null;
    const content = fs.readFileSync(startupPath, 'utf8');
    const match = content.match(/^OPENCHAMBER_MEMORY_ENABLE=['"]?([^'"\r\n]+)['"]?/m);
    return match ? match[1] : null;
  } catch {
    return null;
  }
};

export const isAgentMemoryFeatureAvailable = ({ ignoreFallback = false } = {}) => {
  const envVal = process.env.OPENCHAMBER_MEMORY_ENABLE;
  const raw = envVal !== undefined
    ? envVal
    : (ignoreFallback || process.env.NODE_ENV === 'test' ? undefined : readStartupEnvValue());
  return typeof raw === 'string' && TRUTHY.has(raw.trim().toLowerCase());
};

/**
 * The OpenCode → transcript source (Rev PRD-07 §3.2 → the ingestion path).
 *
 * Wires the idle-detector's two injected data sources to OpenCode:
 *   - `listSessions`  → `client.session.list` (global, newest first) → `{ id, lastActivity }`
 *   - `readTranscript` → `client.session.get` + `client.message.list` (turns)
 *                        + the working-tree diff (files, with content)
 *
 * The transcript is shaped for Rev's `POST /session/distill`:
 *   { schemaVersion, sessionId, domain, turns: [{ turnId, text }], files: { path → content } }
 *
 * THE FILES ARE NOT EMPTY. A learning is only verifiable when the file it cites
 * can be hash-pinned, so `readTranscript` snapshots the working-tree diff at idle
 * detection — `getStatus` for the changed paths, one `readFile` per path — and
 * passes the content through. Deleted and unreadable paths are skipped (their
 * citation cannot be pinned). The `domain` is the session directory's basename:
 * a real, coarse, useful tag, not a classifier (per PRD-07's "classifier-derived"
 * being aspirational).
 */

import { basename, join } from 'node:path';

const PAGE = 200;
const SCHEMA_VERSION = '1.0.0';

/** The settled text of one message record, or '' when it has none. */
const textOf = (message) => {
  if (message?.type === 'user') return (message?.text ?? '').trim();
  if (message?.type === 'assistant') {
    const parts = [];
    for (const part of message?.content ?? []) {
      if (part?.type === 'text' && typeof part?.text === 'string' && part.text.trim()) {
        parts.push(part.text.trim());
      }
    }
    return parts.join('\n\n');
  }
  return '';
};

/** The messages of a session as turns, oldest first. */
const readTurns = async (client, sessionId) => {
  const turns = [];
  let cursor = null;
  for (;;) {
    const page = await client.message.list({
      sessionID: sessionId,
      limit: PAGE,
      ...(cursor ? { cursor } : { order: 'asc' }),
    });
    for (const record of page?.data ?? []) {
      const text = textOf(record);
      if (!text || !record?.id) continue;
      turns.push({ turnId: record.id, text });
    }
    const next = page?.cursor?.next ?? null;
    if (!next || (page?.data?.length ?? 0) < PAGE) break;
    cursor = next;
  }
  return turns;
};

/** The files the session touched at idle detection, path → content. */
const readFiles = async ({ getStatus, getRepositoryRoot, readFile }, directory) => {
  if (!directory) return {};
  const repoRoot = await getRepositoryRoot(directory).catch(() => null);
  if (!repoRoot) return {};
  const status = await getStatus(directory, { mode: 'light' }).catch(() => null);
  const files = {};
  for (const entry of status?.files ?? []) {
    const filePath = entry?.path;
    if (!filePath) continue;
    const content = await readFile(join(repoRoot, filePath), 'utf8').catch(() => null);
    if (content !== null) files[filePath] = content;
  }
  return files;
};

/**
 * @param {{ createClient: (directory: string) => any,
 *           getStatus: (directory: string, options: any) => Promise<any>,
 *           getRepositoryRoot: (directory: string) => Promise<string>,
 *           readFile: (path: string, encoding: string) => Promise<string> }} deps
 */
export const createTranscriptSource = ({ createClient, getStatus, getRepositoryRoot, readFile }) => {
  const listSessions = async () => {
    const client = createClient('');
    const sessions = [];
    let cursor = null;
    for (;;) {
      const page = await client.session.list({
        parentID: null,
        limit: PAGE,
        ...(cursor ? { cursor } : { order: 'desc' }),
      });
      for (const record of page?.data ?? []) {
        if (!record?.id || !Number.isFinite(record?.time?.updated)) continue;
        sessions.push({ id: record.id, lastActivity: record.time.updated });
      }
      const next = page?.cursor?.next ?? null;
      if (!next) break;
      cursor = next;
    }
    return sessions;
  };

  const readTranscript = async (sessionId) => {
    const global = createClient('');
    const session = await global.session.get({ sessionID: sessionId });
    const directory = session?.location?.directory || '';
    const scoped = directory ? createClient(directory) : global;
    const turns = await readTurns(scoped, sessionId);
    if (turns.length === 0) return null;
    const files = await readFiles({ getStatus, getRepositoryRoot, readFile }, directory);
    return {
      schemaVersion: SCHEMA_VERSION,
      sessionId,
      domain: basename(directory) || 'session',
      turns,
      files,
    };
  };

  return { listSessions, readTranscript };
};

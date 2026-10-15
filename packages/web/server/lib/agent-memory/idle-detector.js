/**
 * The idle-detector (Rev PRD-07 §3.2 → the ingestion path).
 *
 * Writes completed-session transcripts to `~/.oio/sessions_pending/`, which Rev's
 * sweep then distils. A session is "completed" when it has been idle longer than a
 * threshold; the window-gating (distil in-window, queue out-of-window) lives in
 * Rev's sweep, not here — this side only decides WHEN a session is done and hands
 * over its transcript.
 *
 * The two data sources — listing sessions and reading a transcript — are injected,
 * so the decision logic is testable without OpenCode; the server wires them to
 * `client.session.list` and `client.session.message.get`. Same seam pattern as the
 * mirror and the index queue: pure logic here, one wiring point in the server.
 */

import { join } from 'node:path';

/**
 * Find every session idle beyond `thresholdMs` and write its transcript to the
 * pending dir. Idempotent by session id: re-running overwrites the same file, so a
 * session that is still idle on the next pass is re-written, not duplicated.
 *
 * @param {{ listSessions: () => Promise<Array<{id: string, lastActivity: number}>>,
 *           readTranscript: (id: string) => Promise<Record<string, unknown> | null>,
 *           fsPromises: typeof import('node:fs/promises'),
 *           pendingDir: string, thresholdMs: number, now?: () => number }} deps
 * @returns {Promise<{written: number, skipped: number}>}
 */
export async function writeIdleTranscripts(deps) {
  const now = deps.now ?? (() => Date.now());
  const sessions = await deps.listSessions();

  let written = 0;
  let skipped = 0;

  for (const session of sessions) {
    if (now() - session.lastActivity < deps.thresholdMs) {
      skipped += 1;
      continue;
    }

    const transcript = await deps.readTranscript(session.id);
    if (!transcript) {
      skipped += 1;
      continue;
    }

    await deps.fsPromises.mkdir(deps.pendingDir, { recursive: true });
    await deps.fsPromises.writeFile(
      join(deps.pendingDir, `${session.id}.json`),
      JSON.stringify(transcript),
      'utf8',
    );
    written += 1;
  }

  return { written, skipped };
}

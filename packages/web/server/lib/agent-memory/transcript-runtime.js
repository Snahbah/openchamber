/**
 * The transcript runtime (Rev PRD-07 §3.2 → the ingestion path).
 *
 * Wires the idle-detector and the transcript source to OpenCode, and runs the
 * idle sweep on a timer. The full loop it feeds is:
 *
 *   session idles → this writes a transcript to `~/.oio/sessions_pending/`
 *   → Rev's sweep distils it in-window → a `session_learning` lands in
 *   `~/.oio/session_learning.jsonl` → the mirror promotes it to a vault note
 *   → the next session retrieves it.
 *
 * This side only decides WHEN a session is done (idle beyond `thresholdMs`) and
 * hands over its transcript (turns + the working-tree files). The window-gating
 * and the distillation live in Rev.
 */

import os from 'node:os';
import path from 'node:path';
import fsPromises from 'node:fs/promises';
import { OpenCode } from '@opencode/client';

import { writeIdleTranscripts } from './idle-detector.js';
import { createTranscriptSource } from './transcript-source.js';

const IDLE_THRESHOLD_MS = 30 * 60 * 1000;
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

export const createTranscriptRuntime = ({
  buildOpenCodeUrl,
  getOpenCodeAuthHeaders,
  getStatus,
  getRepositoryRoot,
  pendingDir = path.join(os.homedir(), '.oio', 'sessions_pending'),
  thresholdMs = IDLE_THRESHOLD_MS,
  intervalMs = SWEEP_INTERVAL_MS,
  logger = console,
}) => {
  // Same client factory as the message-search runtime: scoped by directory via
  // the `x-opencode-directory` header, with `''` meaning the global instance.
  const createClient = (directory) => {
    const headers = { ...getOpenCodeAuthHeaders() };
    if (directory) headers['x-opencode-directory'] = encodeURIComponent(directory);
    return OpenCode.make({ baseUrl: buildOpenCodeUrl('/', '').replace(/\/$/, ''), headers });
  };

  const source = createTranscriptSource({
    createClient,
    getStatus,
    getRepositoryRoot,
    readFile: (filePath, encoding) => fsPromises.readFile(filePath, encoding),
  });

  let timer = null;
  let running = false;

  const runOnce = async () => {
    if (running) return null;
    running = true;
    try {
      const result = await writeIdleTranscripts({
        listSessions: source.listSessions,
        readTranscript: source.readTranscript,
        fsPromises,
        pendingDir,
        thresholdMs,
      });
      if (result.written > 0) logger.info?.('[transcripts] wrote', result);
      return result;
    } catch (error) {
      logger.warn?.('[transcripts]', error?.message ?? error);
      return null;
    } finally {
      running = false;
    }
  };

  return {
    start: () => {
      void runOnce();
      timer = setInterval(() => void runOnce(), intervalMs);
      timer.unref?.();
    },
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
    },
    runOnce,
  };
};

/**
 * The session-learning mirror (Rev PRD-07 §3.2 → §3.3).
 *
 * Rev's `POST /session/distill` writes `session_learning` records to
 * `~/.oio/session_learning.jsonl`. This module reads that file at boot and promotes
 * each VERIFIED learning into the vault, so a learning distilled in one session is
 * retrieved in the next. Quarantined (unverified) learnings are skipped — a
 * hallucinated learning must not enter the vault as fact.
 */

/**
 * Parse a JSONL text into the verified learnings to promote. Pure and tolerant:
 * a torn final line and a non-learning line are skipped, never thrown on.
 */
export const parseSessionLearnings = (text) => {
  const learnings = [];
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue; // a torn final line is normal for an append-only log
    }
    if (record?.type !== 'session_learning') continue;
    const list = Array.isArray(record.learnings) ? record.learnings : [];
    for (let index = 0; index < list.length; index += 1) {
      const learning = list[index];
      if (!learning || learning.verified !== true) continue;
      learnings.push({ learning, sessionId: record.sessionId, domain: record.domain, index });
    }
  }
  return learnings;
};

/**
 * Read the JSONL and promote each verified learning into the vault. Idempotent:
 * re-promotion overwrites the same note (`sl_<sessionId>_<index>`).
 */
export const mirrorSessionLearnings = async ({
  filePath,
  fsPromises,
  promoteSessionLearning,
  syncFile,
}) => {
  const text = await fsPromises.readFile(filePath, 'utf8').catch(() => '');
  for (const { learning, sessionId, domain, index } of parseSessionLearnings(text)) {
    const { path: notePath } = await promoteSessionLearning(learning, sessionId, domain, index);
    await syncFile(notePath);
  }
};

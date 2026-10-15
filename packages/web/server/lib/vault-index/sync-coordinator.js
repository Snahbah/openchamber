/**
 * Debounced, change-aware sync coordinator for the vault → index bridge.
 *
 * Corrects the three defects in the original daemon the report named: no
 * debounce (every save re-embedded the file), no change detection (unchanged
 * files were re-embedded on every event), and a fragile loop (one bad file
 * killed the whole daemon).
 *
 * [DECISION_RECORD] An unchanged file is skipped by a (mtime_ns, size) stamp,
 *   the same cache discipline Cutter's typed memory uses.
 * [DECISION_RECORD] A failure on one path is logged and the sweep continues:
 *   one broken note must not block the rest of the vault.
 */

export const createSyncCoordinator = ({
  readFile,
  stat,
  syncFile,
  evictFile,
  debounceMs = 1500,
  now = () => Date.now(),
  logger = () => {},
}) => {
  const pending = new Map(); // path -> { type, at }
  const seen = new Map(); // path -> { mtimeNs, size }

  const handle = (type, relativePath) => {
    pending.set(relativePath, { type, at: now() });
  };

  const flush = async () => {
    const cutoff = now() - debounceMs;
    const ready = [...pending.entries()].filter(([, p]) => p.at <= cutoff);
    const results = [];

    for (const [relativePath, p] of ready) {
      pending.delete(relativePath);
      try {
        if (p.type === 'delete') {
          seen.delete(relativePath);
          const count = await evictFile(relativePath);
          results.push({ relativePath, outcome: 'evicted', count });
          continue;
        }

        const stamp = await stat(relativePath);
        const previous = seen.get(relativePath);
        if (previous && previous.mtimeNs === stamp.mtimeNs && previous.size === stamp.size) {
          results.push({ relativePath, outcome: 'unchanged' });
          continue;
        }

        const text = await readFile(relativePath);
        const synced = await syncFile(relativePath, text);
        seen.set(relativePath, { mtimeNs: stamp.mtimeNs, size: stamp.size });
        results.push({ relativePath, outcome: 'synced', indexed: synced.indexed });
      } catch (error) {
        logger(relativePath, error);
        results.push({
          relativePath,
          outcome: 'failed',
          error: error && error.message ? error.message : String(error),
        });
      }
    }

    return results;
  };

  return { handle, flush };
};

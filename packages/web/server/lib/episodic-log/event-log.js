/**
 * Append-only episodic event log — Tier 1 working memory.
 *
 * Cutter's River transposed to OpenChamber: one JSONL file per log directory,
 * append-only, never truncated, never pruned, rotating to an archive at a size
 * cap, Lamport-sequenced so causal order survives clock drift, and strict
 * provenance so an unattributed event is refused rather than laundered.
 *
 * [DECISION_RECORD] Lamport `seq` is a monotonic integer persisted across
 *   restarts by resuming from the highest seq found on boot.
 * [DECISION_RECORD] Strict provenance is the default: an event whose
 *   `source_provenance.substrate_kind` is empty is refused with an error.
 * [DECISION_RECORD] A write failure fails open (returns false, never throws);
 *   a corrupt line is skipped on read, never fatal.
 *
 * Rotation: when the active log would exceed `maxLogSize`, it is moved to
 * `archive/events_<iso>_<firstSeq>.jsonl` and a fresh active log begins.
 * `replay`, `tail`, and `count` chain across the active log and every archive.
 */

import path from 'node:path';

const ACTIVE_LOG_NAME = 'events.jsonl';
const ARCHIVE_DIR_NAME = 'archive';
const DEFAULT_MAX_LOG_SIZE = 100 * 1024 * 1024; // 100 MB

const toIso = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
};

const serialize = (event) => JSON.stringify(event) + '\n';

const parseLine = (line) => {
  const trimmed = line && line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null; // corrupt line, skipped
  }
};

const readEventsFromFile = async (fsPromises, filePath) => {
  try {
    const text = await fsPromises.readFile(filePath, 'utf8');
    return text.split('\n').map(parseLine).filter(Boolean);
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
};

const listArchiveFiles = async (fsPromises, archiveDir) => {
  try {
    const names = await fsPromises.readdir(archiveDir);
    return names
      .filter((name) => name.startsWith('events_') && name.endsWith('.jsonl'))
      .sort();
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
};

export const createEventLog = (deps) => {
  const fsPromises = deps.fsPromises?.promises || deps.fsPromises;
  const {
    path,
    logDir,
    maxLogSize = DEFAULT_MAX_LOG_SIZE,
    strictProvenance = true,
    now = () => new Date(),
  } = deps;

  if (!fsPromises) throw new Error('fsPromises is required');
  if (!logDir) throw new Error('logDir is required');

  const activePath = path.join(logDir, ACTIVE_LOG_NAME);
  const archiveDir = path.join(logDir, ARCHIVE_DIR_NAME);

  let seq = 0;
  let activeSize = 0;
  let booted = false;
  let writeChain = Promise.resolve();

  const ensureDirs = async () => {
    await fsPromises.mkdir(logDir, { recursive: true });
    await fsPromises.mkdir(archiveDir, { recursive: true });
  };

  const activeEvents = () => readEventsFromFile(fsPromises, activePath);

  const archivedEvents = async () => {
    const files = await listArchiveFiles(fsPromises, archiveDir);
    const batches = await Promise.all(
      files.map((name) => readEventsFromFile(fsPromises, path.join(archiveDir, name))),
    );
    return batches.flat().sort((a, b) => a.seq - b.seq);
  };

  const assertProvenance = (input) => {
    if (!strictProvenance) return;
    const kind = input && input.source_provenance && input.source_provenance.substrate_kind;
    if (typeof kind !== 'string' || !kind.trim()) {
      throw new Error('event source_provenance.substrate_kind is required in strict provenance mode');
    }
  };

  const boot = async () => {
    await ensureDirs();
    const [archived, active] = await Promise.all([archivedEvents(), activeEvents()]);
    for (const event of [...archived, ...active]) {
      if (Number.isInteger(event.seq) && event.seq > seq) seq = event.seq;
    }
    try {
      const stat = await fsPromises.stat(activePath);
      activeSize = stat.size;
    } catch {
      activeSize = 0;
    }
    booted = true;
    return { seq, count: archived.length + active.length };
  };

  const rotate = async () => {
    const events = await activeEvents();
    if (events.length === 0) return;
    const firstSeq = events[0].seq;
    const stamp = toIso(now()).replace(/[:.]/g, '-');
    const archiveName = `events_${stamp}_${firstSeq}.jsonl`;
    await fsPromises.rename(activePath, path.join(archiveDir, archiveName));
    activeSize = 0;
  };

  const append = async (input) => {
    if (!booted) throw new Error('event log not booted; call boot() first');
    assertProvenance(input);

    seq += 1;
    const event = {
      seq,
      kind: input.kind,
      ts: toIso(input.ts ?? now()),
      source_provenance: input.source_provenance,
      ...(input.payload !== undefined ? { payload: input.payload } : {}),
    };
    const line = serialize(event);

    // Serialize through the chain so concurrent appends cannot interleave a
    // seq assignment with its disk write.
    const run = async () => {
      try {
        await ensureDirs();
        const lineBytes = Buffer.byteLength(line, 'utf8');
        if (activeSize > 0 && activeSize + lineBytes > maxLogSize) {
          await rotate();
        }
        await fsPromises.appendFile(activePath, line, 'utf8');
        activeSize += lineBytes;
        return true;
      } catch {
        // Fail-open: the event may or may not have landed; report false and
        // let the caller decide. Never throw, never roll back seq.
        return false;
      }
    };

    const result = writeChain.then(run, run);
    writeChain = result.then(() => {}, () => {});
    return result;
  };

  const replay = async () => {
    await ensureDirs();
    const [archived, active] = await Promise.all([archivedEvents(), activeEvents()]);
    return [...archived, ...active].sort((a, b) => a.seq - b.seq);
  };

  const tail = async (limit) => {
    if (limit <= 0) return [];
    const events = await replay();
    return events.slice(-limit);
  };

  const count = async () => {
    const [archived, active] = await Promise.all([archivedEvents(), activeEvents()]);
    return archived.length + active.length;
  };

  return { boot, append, replay, tail, count };
};

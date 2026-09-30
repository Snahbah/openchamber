/**
 * Semantic index runtime — wires the embedder, LanceDB store, and vault index
 * into one lazy, server-callable service (Tier 2).
 *
 * Lazy by design: the embedder loads a large ONNX model and LanceDB opens a
 * native-backed table, so neither happens until the first sync or query.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { createVaultIndex } from './index.js';
import { createLanceStore } from './lance-store.js';
import { createEmbedder } from './embedder.js';

const walkMdFiles = async (dir) => {
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.')) stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        out.push(full);
      }
    }
  }
  return out;
};

export const createVaultIndexRuntime = ({ vaultDir, dbPath, tableName, modelPath, vocabPath }) => {
  let db = null;
  let embedder = null;
  let index = null;
  let initPromise = null;

  const connect = async () => {
    if (!db) {
      // Loaded lazily so the server does not import the native LanceDB binding
      // at boot.
      const lancedb = await import('@lancedb/lancedb');
      db = await lancedb.connect(dbPath);
    }
    return db;
  };

  const init = async () => {
    if (!initPromise) {
      initPromise = (async () => {
        embedder = await createEmbedder({ modelPath, vocabPath });
        const connection = await connect();
        const store = createLanceStore({
          db: connection,
          tableName,
          embed: (docs) => embedder.embed(docs),
        });
        index = createVaultIndex({ store });

        // Seed a row so LanceDB can infer the vector dimension on first use.
        try {
          await connection.openTable(tableName);
        } catch {
          const [probe] = await embedder.embed(['seed']);
          await connection.createTable(tableName, [
            { id: 'seed', vector: probe, text: '', source_path: '', metadata: '{}' },
          ]);
        }
      })();
    }
    return initPromise;
  };

  const syncFile = async (relativePath) => {
    await init();
    const full = path.isAbsolute(relativePath) ? relativePath : path.join(vaultDir, relativePath);
    const rel = path.relative(vaultDir, full).split(path.sep).join('/');
    const text = await fs.readFile(full, 'utf8');
    return index.syncFile(rel, text);
  };

  const syncVault = async (options = {}) => {
    await init();
    const targetFile = options.file || options.relativePath;
    if (targetFile) {
      const result = await syncFile(targetFile);
      return [result];
    }

    const files = await walkMdFiles(vaultDir);
    const limit = typeof options.limit === 'number' && options.limit > 0 ? options.limit : files.length;
    const targetFiles = files.slice(0, limit);
    const results = [];

    for (const file of targetFiles) {
      const rel = path.relative(vaultDir, file).split(path.sep).join('/');
      try {
        const text = await fs.readFile(file, 'utf8');
        const res = await index.syncFile(rel, text);
        results.push(res);
      } catch (err) {
        results.push({ relativePath: rel, error: err?.message || String(err), indexed: 0 });
      }
      // Yield to the event loop between files to prevent starving HTTP I/O
      await new Promise((resolve) => setImmediate(resolve));
    }
    return results;
  };

  const query = async (text, limit = 5) => {
    await init();
    const [vector] = await embedder.embed([text]);
    const table = await db.openTable(tableName);
    const rows = await table.vectorSearch(vector).limit(limit).toArray();
    return rows.map((row) => ({ id: row.id, text: row.text, source_path: row.source_path }));
  };

  return { init, syncFile, syncVault, query };
};

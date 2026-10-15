/**
 * Ingestion script to migrate exported ChromaDB collections into local LanceDB tables.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import lancedb from '@lancedb/lancedb';

const DUMP_PATH = 'C:/Users/Ross/AppData/Local/Temp/chroma_dump.json';
const STORES_DIR = path.join(
  process.env.USERPROFILE || process.env.HOME || '.',
  '.config',
  'openchamber',
  'stores',
  'chromadb_migrated'
);

const sanitizeTableName = (name) => name.replace(/[^a-zA-Z0-9_]/g, '_');

const run = async () => {
  console.log(`Reading dump from ${DUMP_PATH}...`);
  const raw = await fs.readFile(DUMP_PATH, 'utf8');
  const dump = JSON.parse(raw);

  await fs.mkdir(STORES_DIR, { recursive: true });
  console.log(`Connecting to LanceDB at ${STORES_DIR}...`);
  const db = await lancedb.connect(STORES_DIR);

  const allRows = [];
  const report = {};

  for (const [collectionName, data] of Object.entries(dump)) {
    const { ids, documents, metadatas, embeddings } = data;
    const count = ids.length;
    if (count === 0) {
      report[collectionName] = { count: 0, status: 'empty' };
      continue;
    }

    const rows = [];
    for (let i = 0; i < count; i += 1) {
      const meta = metadatas[i] || {};
      const row = {
        id: ids[i],
        vector: embeddings[i],
        text: documents[i] || '',
        collection: collectionName,
        metadata: JSON.stringify(meta),
        source: typeof meta.source === 'string' ? meta.source : '',
        topic: typeof meta.topic === 'string' ? meta.topic : '',
        date: typeof meta.date === 'string' ? meta.date : '',
      };
      rows.push(row);
      allRows.push(row);
    }

    const tableName = sanitizeTableName(collectionName);
    console.log(`Creating table '${tableName}' with ${count} records...`);
    try {
      await db.createTable(tableName, rows, { mode: 'overwrite' });
      report[collectionName] = { tableName, count, status: 'success' };
    } catch (err) {
      console.error(`Failed to create table ${tableName}:`, err);
      report[collectionName] = { tableName, count, status: 'failed', error: String(err) };
    }
  }

  // Also create a unified 'all_collections' table
  console.log(`Creating unified table 'all_collections' with ${allRows.length} records...`);
  await db.createTable('all_collections', allRows, { mode: 'overwrite' });
  report['all_collections'] = { tableName: 'all_collections', count: allRows.length, status: 'success' };

  console.log('\n=== Ingestion Summary ===');
  console.table(report);

  // Verification queries
  console.log('\n=== Verifying Queries on Migrated Tables ===');
  for (const collectionName of Object.keys(dump)) {
    const tableName = sanitizeTableName(collectionName);
    const table = await db.openTable(tableName);
    const count = await table.countRows();
    const probe = await table.query().limit(1).toArray();
    console.log(`Table ${tableName}: verified ${count} rows, sample ID: '${probe[0]?.id}'`);
  }

  const unifiedTable = await db.openTable('all_collections');
  const total = await unifiedTable.countRows();
  console.log(`Unified table all_collections: verified ${total} total rows.`);

  // Test vector search on estate-topology table
  const estateTable = await db.openTable('estate_topology');
  const firstRow = (await estateTable.query().limit(1).toArray())[0];
  const searchResults = await estateTable.vectorSearch(firstRow.vector).limit(3).toArray();
  console.log(`\nVector search probe on 'estate_topology' (top 3 matches):`);
  searchResults.forEach((r, idx) => {
    console.log(`  ${idx + 1}. [${r.id}] ${r.text.slice(0, 80)}...`);
  });
};

run().catch((err) => {
  console.error('Fatal ingestion error:', err);
  process.exit(1);
});

/**
 * Unified Estate Knowledge Engine (LanceDB In-Process Service).
 *
 * Consolidates all three local LanceDB datasets into a single, high-performance,
 * zero-daemon in-process service inside OpenChamber:
 *
 *   1. Domain 'vault': OpenChamber memory & curated Obsidian vault notes (768-d BGE + Tantivy FTS).
 *   2. Domain 'typescript': Waves 2 TypeScript & modern web platform reference (768-d Nomic + Tantivy FTS).
 *   3. Domain 'adobe': Adobe CC ActionDescriptors, C++ signatures & negative guardrails (Tantivy FTS + Scalar Pre-filters).
 *
 * Implements Reciprocal Rank Fusion (RRF) between lexical FTS and dense vector search,
 * query-shape routing, and negative guardrail extraction without external Python daemons.
 */

import path from 'node:path';
import lancedb from '@lancedb/lancedb';

const RRF_K = 60;

/**
 * Reciprocal Rank Fusion of ranked candidate lists.
 * @param {Array<Array<string>>} lists - lists of IDs in rank order
 * @param {Array<number>} weights - per-list weighting
 */
export const rrf = (lists, weights = null) => {
  const effectiveWeights = weights || lists.map(() => 1.0);
  const scores = new Map();

  lists.forEach((list, listIdx) => {
    const weight = effectiveWeights[listIdx] || 1.0;
    list.forEach((id, rank) => {
      const current = scores.get(id) || 0;
      scores.set(id, current + weight / (RRF_K + rank + 1));
    });
  });

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
};

export const createEstateKnowledgeEngine = ({
  vaultDbPath,
  typescriptDbPath,
  adobeDbPath,
  maxonDbPath,
  openchamberDbPath,
  unrealDbPath,
  rustDbPath,
  embedder = null, // in-process 768-d WASM embedder
}) => {
  let vaultTable = null;
  let tsTable = null;
  let adobeTable = null;
  let maxonTable = null;
  let openchamberTable = null;
  let unrealTable = null;
  let rustTable = null;
  let initPromise = null;

  const init = async () => {
    if (!initPromise) {
      initPromise = (async () => {
        if (vaultDbPath) {
          try {
            const db = await lancedb.connect(vaultDbPath);
            vaultTable = await db.openTable('vault');
          } catch (e) {
            console.warn('[estate-knowledge] vault table not available:', e.message);
          }
        }
        if (typescriptDbPath) {
          try {
            const db = await lancedb.connect(typescriptDbPath);
            tsTable = await db.openTable('typescript_reference_library');
          } catch (e) {
            console.warn('[estate-knowledge] typescript table not available:', e.message);
          }
        }
        if (adobeDbPath) {
          try {
            const db = await lancedb.connect(adobeDbPath);
            adobeTable = await db.openTable('adobe_cards');
          } catch (e) {
            console.warn('[estate-knowledge] adobe table not available:', e.message);
          }
        }
        if (maxonDbPath) {
          try {
            const db = await lancedb.connect(maxonDbPath);
            maxonTable = await db.openTable('maxon_core');
          } catch (e) {
            console.warn('[estate-knowledge] maxon table not available:', e.message);
          }
        }
        if (openchamberDbPath) {
          try {
            const db = await lancedb.connect(openchamberDbPath);
            openchamberTable = await db.openTable('openchamber_core');
          } catch (e) {
            console.warn('[estate-knowledge] openchamber table not available:', e.message);
          }
        }
        if (unrealDbPath) {
          try {
            const db = await lancedb.connect(unrealDbPath);
            unrealTable = await db.openTable('unreal_engine_core');
          } catch (e) {
            console.warn('[estate-knowledge] unreal table not available:', e.message);
          }
        }
        if (rustDbPath) {
          try {
            const db = await lancedb.connect(rustDbPath);
            rustTable = await db.openTable('rust_core');
          } catch (e) {
            console.warn('[estate-knowledge] rust table not available:', e.message);
          }
        }
      })();
    }
    return initPromise;
  };

  /**
   * Hybrid search across Vault memory notes.
   */
  const queryVault = async (queryText, limit = 5) => {
    await init();
    if (!vaultTable) return [];

    let vecRows = [];
    if (embedder) {
      try {
        const [vector] = await embedder.embed([queryText]);
        vecRows = await vaultTable.vectorSearch(vector).limit(limit * 2).toArray();
      } catch {}
    }

    let ftsRows = [];
    try {
      ftsRows = await vaultTable.search(queryText, 'fts').limit(limit * 2).toArray();
    } catch {}

    const byId = new Map();
    for (const r of [...vecRows, ...ftsRows]) byId.set(r.id, r);

    // Query shape weighting
    const isToken = queryText.trim().split(/\s+/).length <= 2 && queryText.length <= 16;
    const weights = isToken ? [1.6, 1.0] : [1.0, 1.6]; // [fts, vector]

    const fusedIds = rrf([ftsRows.map((r) => r.id), vecRows.map((r) => r.id)], weights);
    const chosen = fusedIds.slice(0, limit).map((id) => byId.get(id)).filter(Boolean);

    return chosen.map((r) => ({
      domain: 'vault',
      id: r.id,
      text: r.text,
      source: r.source_path || '',
      metadata: r.metadata ? JSON.parse(r.metadata) : {},
    }));
  };

  /**
   * Hybrid search across Waves 2 TypeScript reference cards.
   */
  const queryTypeScript = async (queryText, limit = 5) => {
    await init();
    if (!tsTable) return [];

    let vecRows = [];
    if (embedder) {
      try {
        const [vector] = await embedder.embed([queryText]);
        vecRows = await tsTable.vectorSearch(vector).limit(limit * 2).toArray();
      } catch {}
    }

    let ftsRows = [];
    try {
      ftsRows = await tsTable.search(queryText, 'fts').limit(limit * 2).toArray();
    } catch {}

    const byId = new Map();
    for (const r of [...vecRows, ...ftsRows]) byId.set(r.id, r);

    const isToken = queryText.trim().split(/\s+/).length <= 2 && queryText.length <= 16;
    const weights = isToken ? [1.6, 1.0] : [1.0, 1.6];

    const fusedIds = rrf([ftsRows.map((r) => r.id), vecRows.map((r) => r.id)], weights);
    const chosen = fusedIds.slice(0, limit).map((id) => byId.get(id)).filter(Boolean);

    return chosen.map((r) => ({
      domain: 'typescript',
      id: r.id,
      category: r.category,
      h1: r.h1,
      h2: r.h2,
      text: r.text,
      source: r.source || r.file_name || '',
    }));
  };

  /**
   * Hybrid & Tantivy FTS search across Adobe Creative Cloud execution cards.
   */
  const queryAdobe = async (queryText, { host = null, runtime = null, era = null, verifiedOnly = true, limit = 5 } = {}) => {
    await init();
    if (!adobeTable) return [];

    const conditions = [];
    if (host) conditions.push(`host = '${host.replace(/'/g, "''")}'`);
    if (runtime) conditions.push(`runtime_engine = '${runtime.replace(/'/g, "''")}'`);
    if (era) conditions.push(`era = '${era.replace(/'/g, "''")}'`);
    if (verifiedOnly) conditions.push('verified = true');

    const filterClause = conditions.length > 0 ? conditions.join(' AND ') : null;

    let queryBuilder = adobeTable.search(queryText, 'fts').limit(limit * 2);
    if (filterClause) {
      queryBuilder = queryBuilder.where(filterClause);
    }

    let rows = [];
    try {
      rows = await queryBuilder.toArray();
    } catch {
      rows = await adobeTable.query().where(filterClause || '1=1').limit(limit).toArray();
    }

    return rows.slice(0, limit).map((r) => {
      let card = {};
      try { card = JSON.parse(r.card_json); } catch {}
      return {
        domain: 'adobe',
        id: r.id,
        host: r.host,
        category: r.category,
        symbol: r.symbol,
        fourcc: r.fourcc,
        verified: r.verified,
        positive_patterns: card.positive_patterns || [],
        negative_guardrails: card.negative_guardrails || [],
        signature: card.signature || null,
        requires_modal: card.requires_modal || false,
        source: card.provenance?.source_path || '',
      };
    });
  };

  /**
   * Surfaces negative guardrails and crash traps for an intended action.
   */
  const checkNegativeGuardrails = async (actionText, { host = null, runtime = null } = {}) => {
    const cards = await queryAdobe(actionText, { host, runtime, verifiedOnly: false, limit: 10 });
    const actionWords = new Set(actionText.toLowerCase().match(/\w+/g) || []);

    const scored = cards.map((card) => {
      const guardrailText = (card.negative_guardrails || []).join(' ').toLowerCase();
      const matches = (guardrailText.match(/\w+/g) || []).filter((w) => actionWords.has(w));
      return { card, score: matches.length };
    });

    scored.sort((a, b) => b.score - a.score);
    const chosen = scored.filter((s) => s.score > 0).map((s) => s.card);

    return {
      action: actionText,
      guardrailsFound: chosen.length > 0,
      warnings: chosen.flatMap((c) => (c.negative_guardrails || []).map((g) => `[${c.id}] ${g}`)),
      matchedCards: chosen.slice(0, 3),
    };
  };

  /**
   * Preflight check to scan code for known host crash hazards before dispatch.
   */
  const preflight = async (codeText, { host = 'photoshop' } = {}) => {
    const issues = [];
    if (host === 'photoshop' && codeText.includes('batchPlay')) {
      if (!codeText.includes('executeAsModal')) {
        issues.push({
          severity: 'blocking',
          message: 'CRITICAL: Calling batchPlay outside executeAsModal throws error code 9 in Photoshop UXP.',
        });
      }
    }
    if (codeText.includes('pointsUnit') && codeText.match(/_value:\s*['"][^'"]+['"]/)) {
      issues.push({
        severity: 'warning',
        message: 'A string passed to pointsUnit _value may no-op; ensure numeric value is provided.',
      });
    }

    return {
      clean: issues.filter((i) => i.severity === 'blocking').length === 0,
      issues,
    };
  };

  /**
   * Direct card lookup.
   */
  const getExecutionCard = async (id) => {
    await init();
    if (!adobeTable) return null;
    const sanitizedId = String(id).replace(/'/g, "''");
    const rows = await adobeTable.query().where(`id = '${sanitizedId}'`).limit(1).toArray();
    if (rows.length === 0) return null;
    try {
      return JSON.parse(rows[0].card_json);
    } catch {
      return rows[0];
    }
  };

  /**
   * FTS search across the Maxon C4D knowledge base.
   */
  const queryMaxon = async (queryText, { limit = 5 } = {}) => {
    await init();
    if (!maxonTable) return [];

    let rows = [];
    try {
      rows = await maxonTable.search(queryText, 'fts').limit(limit * 2).toArray();
    } catch {
      rows = await maxonTable.query().limit(limit).toArray();
    }

    return rows.slice(0, limit).map((r) => ({
      domain: 'maxon',
      id: r.id,
      text: r.text,
      source: r.source,
      category: r.category,
      engine: r.engine,
      language: r.language,
      symbolIds: r.symbol_ids || [],
      verified: r.is_verified_solution,
    }));
  };

  /**
   * Hybrid vector & Tantivy FTS search across OpenChamber estate reference knowledge.
   */
  const queryOpenChamber = async (queryText, { limit = 5, pillar = null, category = null, component = null, guardrailsOnly = false } = {}) => {
    await init();
    if (!openchamberTable) return [];

    const conditions = [];
    if (pillar) conditions.push(`pillar = '${pillar.replace(/'/g, "''")}'`);
    if (category) conditions.push(`category = '${category.replace(/'/g, "''")}'`);
    if (component) conditions.push(`component = '${component.replace(/'/g, "''")}'`);
    if (guardrailsOnly) conditions.push('is_guardrail = true');

    const filterClause = conditions.length > 0 ? conditions.join(' AND ') : null;

    let queryBuilder = openchamberTable.search(queryText, 'fts').limit(limit * 2);
    if (filterClause) {
      queryBuilder = queryBuilder.where(filterClause);
    }

    let rows = [];
    try {
      rows = await queryBuilder.toArray();
    } catch {
      let qb = openchamberTable.query();
      if (filterClause) qb = qb.where(filterClause);
      rows = await qb.limit(limit).toArray();
    }

    return rows.slice(0, limit).map((r) => ({
      domain: 'openchamber',
      id: r.id,
      title: r.title,
      pillar: r.pillar,
      category: r.category,
      component: r.component,
      source: r.source,
      source_url: r.source_url,
      content_type: r.content_type,
      is_guardrail: r.is_guardrail,
      symbol_ids: r.symbol_ids || [],
      text: r.text,
    }));
  };

  /**
   * Search across Unreal Engine 5.8 architecture guides & SDK.
   */
  const queryUnreal = async (queryText, { limit = 5, subdomain = null } = {}) => {
    await init();
    if (!unrealTable) return [];

    let queryBuilder = unrealTable.search(queryText, 'fts').limit(limit * 2);
    if (subdomain) {
      queryBuilder = queryBuilder.where(`subdomain = '${subdomain.replace(/'/g, "''")}'`);
    }

    let rows = [];
    try {
      rows = await queryBuilder.toArray();
    } catch {
      rows = await unrealTable.query().limit(limit).toArray();
    }

    return rows.slice(0, limit).map((r) => ({
      domain: 'unreal',
      id: r.id,
      docId: r.doc_id,
      title: r.section_title,
      text: r.text,
      source: r.source,
      sourceUrl: r.source_url,
      subdomain: r.subdomain,
      symbolIds: r.symbol_ids || [],
    }));
  };

  /**
   * Search across Rust & Arrow FFI architecture guides, memory models & SDK specs.
   */
  const queryRust = async (queryText, { limit = 5, subdomain = null, pillar = null } = {}) => {
    await init();
    if (!rustTable) return [];

    const conditions = [];
    if (subdomain) conditions.push(`subdomain = '${subdomain.replace(/'/g, "''")}'`);
    if (pillar) conditions.push(`pillar = '${pillar.replace(/'/g, "''")}'`);
    const filterClause = conditions.length > 0 ? conditions.join(' AND ') : null;

    let queryBuilder = rustTable.search(queryText, 'fts').limit(limit * 2);
    if (filterClause) {
      queryBuilder = queryBuilder.where(filterClause);
    }

    let rows = [];
    try {
      rows = await queryBuilder.toArray();
    } catch {
      let qb = rustTable.query();
      if (filterClause) qb = qb.where(filterClause);
      rows = await qb.limit(limit).toArray();
    }

    return rows.slice(0, limit).map((r) => ({
      domain: 'rust',
      id: r.id,
      docId: r.doc_id,
      title: r.section_title,
      text: r.text,
      source: r.source,
      sourceUrl: r.source_url,
      subdomain: r.subdomain,
      pillar: r.pillar,
      contentType: r.content_type,
      symbolIds: r.symbol_ids || [],
    }));
  };

  /**
   * Unified search across domains ('vault', 'typescript', 'adobe', 'maxon', 'openchamber', 'unreal', 'rust', or 'all').
   */
  const query = async (queryText, { domain = 'vault', limit = 5, ...options } = {}) => {
    if (domain === 'vault') {
      return queryVault(queryText, limit);
    }
    if (domain === 'typescript' || domain === 'ts') {
      return queryTypeScript(queryText, limit);
    }
    if (domain === 'adobe') {
      return queryAdobe(queryText, { limit, ...options });
    }
    if (domain === 'maxon') {
      return queryMaxon(queryText, { limit });
    }
    if (domain === 'openchamber' || domain === 'oc') {
      return queryOpenChamber(queryText, { limit, ...options });
    }
    if (domain === 'unreal' || domain === 'ue') {
      return queryUnreal(queryText, { limit, ...options });
    }
    if (domain === 'rust' || domain === 'rs') {
      return queryRust(queryText, { limit, ...options });
    }
    if (domain === 'all') {
      const [vaultResults, tsResults, adobeResults, maxonResults, ocResults, ueResults, rustResults] = await Promise.all([
        queryVault(queryText, limit),
        queryTypeScript(queryText, limit),
        queryAdobe(queryText, { limit, ...options }),
        queryMaxon(queryText, { limit }),
        queryOpenChamber(queryText, { limit, ...options }),
        queryUnreal(queryText, { limit, ...options }),
        queryRust(queryText, { limit, ...options }),
      ]);
      return [...vaultResults, ...tsResults, ...adobeResults, ...maxonResults, ...ocResults, ...ueResults, ...rustResults].slice(0, limit * 2);
    }
    throw new Error(`Unknown domain: '${domain}'. Valid domains: 'vault', 'typescript', 'adobe', 'maxon', 'openchamber', 'unreal', 'rust', 'all'.`);
  };

  return {
    init,
    query,
    queryVault,
    queryTypeScript,
    queryAdobe,
    queryMaxon,
    queryOpenChamber,
    queryUnreal,
    queryRust,
    getExecutionCard,
    checkNegativeGuardrails,
    preflight,
  };
};

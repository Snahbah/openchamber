import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { createEstateKnowledgeEngine, rrf } from './estate-knowledge.js';

describe('Unified Estate Knowledge Engine (LanceDB In-Process)', () => {
  const baseLanceDir = 'C:/Users/Ross/Documents/GitHub/Lance Databases';
  const vaultDbPath = path.join(process.env.USERPROFILE, '.config', 'openchamber', 'stores', 'vault');
  const tsDbPath = path.join(baseLanceDir, 'typescript_reference.lance');
  const adobeDbPath = path.join(baseLanceDir, 'adobe_codex.lance');

  test('rrf algorithm computes correct rank-fused order', () => {
    const listA = ['doc1', 'doc2', 'doc3'];
    const listB = ['doc2', 'doc1', 'doc4'];
    const fused = rrf([listA, listB]);

    // doc1 and doc2 appear at the top
    expect(fused[0] === 'doc1' || fused[0] === 'doc2').toBe(true);
    expect(fused.includes('doc3')).toBe(true);
    expect(fused.includes('doc4')).toBe(true);
  });

  test('queries TypeScript reference domain via Tantivy FTS', async () => {
    const engine = createEstateKnowledgeEngine({
      typescriptDbPath: tsDbPath,
    });

    const results = await engine.query('AST traversal', { domain: 'typescript', limit: 3 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].domain).toBe('typescript');
    expect(results[0].text).toContain('AST');
  });

  test('queries Adobe domain with exact FourCC lookup & negative guardrails', async () => {
    const engine = createEstateKnowledgeEngine({
      adobeDbPath: adobeDbPath,
    });

    const results = await engine.query('setd', { domain: 'adobe', host: 'photoshop', limit: 2 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].domain).toBe('adobe');
    expect(results[0].fourcc).toBe('setd');
  });

  test('extracts negative guardrails for dangerous actions', async () => {
    const engine = createEstateKnowledgeEngine({
      adobeDbPath: adobeDbPath,
    });

    const check = await engine.checkNegativeGuardrails('call batchPlay without executeAsModal');
    expect(check.guardrailsFound).toBe(true);
    expect(check.warnings.length).toBeGreaterThan(0);
    expect(check.warnings.some((w) => w.includes('executeAsModal'))).toBe(true);
  });

  test('preflight flags missing executeAsModal wrapper', async () => {
    const engine = createEstateKnowledgeEngine({
      adobeDbPath: adobeDbPath,
    });

    const badCode = 'await photoshop.action.batchPlay([{ _obj: "set" }], {});';
    const badCheck = await engine.preflight(badCode, { host: 'photoshop' });
    expect(badCheck.clean).toBe(false);
    expect(badCheck.issues[0].message).toContain('executeAsModal');

    const goodCode = 'await core.executeAsModal(async () => { await photoshop.action.batchPlay(...); });';
    const goodCheck = await engine.preflight(goodCode, { host: 'photoshop' });
    expect(goodCheck.clean).toBe(true);
  });

  test('fetches execution card by direct ID', async () => {
    const engine = createEstateKnowledgeEngine({
      adobeDbPath: adobeDbPath,
    });

    const card = await engine.getExecutionCard('ps_batchplay_text_layer_set_point_size');
    expect(card).not.toBeNull();
    expect(card.id).toBe('ps_batchplay_text_layer_set_point_size');
    expect(card.verified).toBe(true);
  });

  test('cross-domain multi-search combines results', async () => {
    const engine = createEstateKnowledgeEngine({
      typescriptDbPath: tsDbPath,
      adobeDbPath: adobeDbPath,
    });

    const results = await engine.query('compiler batchPlay', { domain: 'all', limit: 2 });
    expect(results.length).toBeGreaterThan(0);
    const domains = new Set(results.map((r) => r.domain));
    expect(domains.size).toBeGreaterThanOrEqual(1);
  });
});

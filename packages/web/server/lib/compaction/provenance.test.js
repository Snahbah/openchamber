import { describe, expect, test } from 'bun:test';

import { classifyTrust, canPin, effectiveVerdict } from './provenance.js';

describe('poison-defence provenance gate', () => {
  test('classifies sub-agent, external, and web sources as low trust', () => {
    expect(classifyTrust({ substrate_kind: 'sub_agent' })).toBe('low');
    expect(classifyTrust({ substrate_kind: 'external' })).toBe('low');
    expect(classifyTrust({ substrate_kind: 'web' })).toBe('low');
  });

  test('classifies an unattributed event as low trust, failing closed', () => {
    expect(classifyTrust(undefined)).toBe('low');
    expect(classifyTrust({ substrate_kind: '' })).toBe('low');
  });

  test('classifies a native thought as high trust', () => {
    expect(classifyTrust({ substrate_kind: 'self_cutter' })).toBe('high');
  });

  test('a low-trust source can never pin', () => {
    expect(canPin({ trust: 'low', pinBasis: 'identity' })).toBe(false);
    expect(canPin({ trust: 'low', pinBasis: 'victory', granted: true })).toBe(false);
  });

  test('a victory pin requires an explicit grant', () => {
    expect(canPin({ trust: 'high', pinBasis: 'victory', granted: false })).toBe(false);
    expect(canPin({ trust: 'high', pinBasis: 'victory', granted: true })).toBe(true);
  });

  test('an identity-tier high-trust pin needs no grant', () => {
    expect(canPin({ trust: 'high', pinBasis: 'identity' })).toBe(true);
  });

  test('demotes a requested pin to admit for a low-trust source', () => {
    expect(effectiveVerdict({ trust: 'low', requested: 'pin' })).toBe('admit');
    expect(effectiveVerdict({ trust: 'high', requested: 'pin' })).toBe('pin');
    expect(effectiveVerdict({ trust: 'low', requested: 'admit' })).toBe('admit');
  });
});

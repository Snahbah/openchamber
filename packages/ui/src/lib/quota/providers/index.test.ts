import { describe, expect, test } from 'bun:test';

import { QUOTA_PROVIDERS } from './index';

describe('quota provider labels', () => {
  test('the Antigravity provider is labelled Agy, never Google', () => {
    const antigravity = QUOTA_PROVIDERS.find((provider) => provider.id === 'google');
    expect(antigravity).toBeDefined();
    expect(antigravity?.name).toBe('Agy');
    expect(antigravity?.name).not.toBe('Google');
  });

  test('provider ids are unique', () => {
    const ids = QUOTA_PROVIDERS.map((provider) => provider.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

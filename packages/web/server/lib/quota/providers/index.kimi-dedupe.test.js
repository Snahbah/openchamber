import { describe, expect, it } from 'vitest';

import { listConfiguredQuotaProviders } from './index.js';

const listWith = (credentials) => listConfiguredQuotaProviders({ readAuth: async () => credentials });

describe('Kimi and Moonshot AI cards for one key', () => {
  it('lists only Kimi when both entries hold the same platform key', async () => {
    const providers = await listWith({ kimi: { key: 'sk-same' }, moonshotai: { type: 'api', key: 'sk-same' } });

    expect(providers).toContain('kimi-for-coding');
    expect(providers).not.toContain('moonshotai');
  });

  it('keeps both cards when the keys differ', async () => {
    const providers = await listWith({ 'kimi-code-plan-cn': { key: 'sk-subscription' }, moonshotai: { key: 'sk-platform' } });

    expect(providers).toContain('kimi-for-coding');
    expect(providers).toContain('moonshotai');
  });

  it('keeps Moonshot AI when there is no Kimi key', async () => {
    expect(await listWith({ moonshotai: { key: 'sk-platform' } })).toContain('moonshotai');
  });
});

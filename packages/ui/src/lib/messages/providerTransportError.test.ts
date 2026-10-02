import { describe, expect, test } from 'bun:test';

import { isLikelyProviderTransportFailure } from './providerTransportError';

describe('isLikelyProviderTransportFailure', () => {
  test('recognises the refused-connect error Bun reports for a dead endpoint', () => {
    expect(
      isLikelyProviderTransportFailure(
        'ConnectionRefused: Unable to connect. Is the computer able to access the url?',
      ),
    ).toBe(true);
  });

  test('recognises the reset-socket error for an endpoint that drops mid-request', () => {
    expect(
      isLikelyProviderTransportFailure(
        'ECONNRESET: The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()',
      ),
    ).toBe(true);
  });

  test('recognises bare error codes, DNS failures, and hung sockets', () => {
    expect(isLikelyProviderTransportFailure('connect ECONNREFUSED 127.0.0.1:4143')).toBe(true);
    expect(isLikelyProviderTransportFailure('getaddrinfo ENOTFOUND api.example.com')).toBe(true);
    expect(isLikelyProviderTransportFailure('socket hang up')).toBe(true);
    expect(isLikelyProviderTransportFailure('fetch failed')).toBe(true);
  });

  test('does not claim authentication failures or ordinary provider errors', () => {
    expect(isLikelyProviderTransportFailure('401 Unauthorized')).toBe(false);
    expect(isLikelyProviderTransportFailure('token refresh failed')).toBe(false);
    expect(
      isLikelyProviderTransportFailure('Model unavailable: local/nemotron-3-super'),
    ).toBe(false);
    expect(isLikelyProviderTransportFailure('aborted')).toBe(false);
  });

  test('ignores absent and blank details', () => {
    expect(isLikelyProviderTransportFailure('')).toBe(false);
    expect(isLikelyProviderTransportFailure('   ')).toBe(false);
    expect(isLikelyProviderTransportFailure(undefined)).toBe(false);
  });
});

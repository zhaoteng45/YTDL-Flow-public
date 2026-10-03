import { describe, expect, it } from 'vitest';
import type { ErrorPayload, JSONValue } from '../src';

describe('ErrorPayload', () => {
  it('provides a standardized error structure with minimal fields', () => {
    const error: ErrorPayload = {
      code: 'NETWORK_TIMEOUT',
      message: 'Connection timed out while fetching video',
    };

    expect(error.code).toBe('NETWORK_TIMEOUT');
    expect(error.message).toBe('Connection timed out while fetching video');
    expect(error.details).toBeUndefined();
  });

  it('preserves JSON-safe details payload without business logic', () => {
    const details: JSONValue = {
      retryCount: 3,
      statusCode: 504,
      nested: { tag: 'gateway' },
      items: [1, 'text', true, null],
    };
    const error: ErrorPayload = {
      code: 'GATEWAY_TIMEOUT',
      message: 'Upstream gateway timeout',
      details,
    };

    expect(error.code).toBe('GATEWAY_TIMEOUT');
    expect(error.message).toBe('Upstream gateway timeout');
    expect(error.details).toEqual(details);
  });
});

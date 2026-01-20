import { describe, expect, it } from 'vitest';

import {
  buildMetaGraphError,
  classifyError,
  MetaGraphAuthError,
  MetaGraphRateLimitError,
  MetaGraphServerError
} from '../src/index.js';

describe('classifyError', () => {
  it('classifies rate limit via status and retry-after', () => {
    const result = classifyError(429, { code: 4 }, { 'Retry-After': '2' });
    expect(result.code).toBe('rate_limit');
    expect(result.retryable).toBe(true);
    expect(result.retryAfterMs).toBe(2000);
  });

  it('classifies auth errors via code', () => {
    const result = classifyError(400, { code: 190 }, {});
    expect(result.code).toBe('auth_error');
    expect(result.retryable).toBe(false);
  });

  it('classifies server errors as retryable', () => {
    const result = classifyError(500, undefined, {});
    expect(result.code).toBe('server_error');
    expect(result.retryable).toBe(true);
  });
});

describe('buildMetaGraphError', () => {
  it('builds rate limit error with retryAfterMs', () => {
    const err = buildMetaGraphError(
      'rate limit hit',
      429,
      { error: { message: 'too many', code: 4 } },
      { 'retry-after': '1' }
    );
    expect(err).toBeInstanceOf(MetaGraphRateLimitError);
    expect(err.retryAfterMs).toBe(1000);
  });

  it('builds auth error for OAuth issues', () => {
    const err = buildMetaGraphError('oauth invalid', 400, { error: { code: 190, message: 'token expired' } });
    expect(err).toBeInstanceOf(MetaGraphAuthError);
    expect(err.retryable).toBe(false);
  });

  it('builds server error when is_transient is true', () => {
    const err = buildMetaGraphError('transient', 400, { error: { is_transient: true } });
    expect(err).toBeInstanceOf(MetaGraphServerError);
    expect(err.retryable).toBe(true);
  });
});

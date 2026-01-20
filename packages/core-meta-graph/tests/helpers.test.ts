import { describe, expect, it, vi } from 'vitest';

import {
  buildGraphUrl,
  DEFAULT_API_VERSION,
  DEFAULT_BASE_URL,
  maskAccessToken,
  maskNumeric,
  parseRetryAfter
} from '../src/index.js';

describe('buildGraphUrl', () => {
  it('combines base, version, path and query params', () => {
    const url = buildGraphUrl(DEFAULT_BASE_URL, DEFAULT_API_VERSION, '/123/messages', { fields: 'id', limit: 10 });
    expect(url).toBe('https://graph.facebook.com/v19.0/123/messages?fields=id&limit=10');
  });

  it('does not duplicate apiVersion when already present', () => {
    const url = buildGraphUrl(DEFAULT_BASE_URL, DEFAULT_API_VERSION, 'v19.0/456', { access_token: 'token' });
    expect(url).toBe('https://graph.facebook.com/v19.0/456?access_token=token');
  });

  it('accepts absolute URLs without base', () => {
    const url = buildGraphUrl('https://graph.facebook.com', 'v19.0', 'https://graph.facebook.com/v19.0/789');
    expect(url).toBe('https://graph.facebook.com/v19.0/789');
  });
});

describe('maskers', () => {
  it('masks access tokens leaving small prefix/suffix', () => {
    const masked = maskAccessToken('AAECAwQFBgcICQoLDA0ODw');
    expect(masked).toBe('AAEC...0ODw');
  });

  it('masks numeric strings to avoid PII leakage', () => {
    expect(maskNumeric('call to +15551234567 failed')).toBe('call to +*********67 failed');
  });
});

describe('parseRetryAfter', () => {
  it('parses numeric seconds', () => {
    expect(parseRetryAfter('5')).toBe(5000);
  });

  it('parses HTTP date formats', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const future = new Date(1_700_000_000_000 + 2000).toUTCString();
    const parsed = parseRetryAfter(future);
    expect(parsed).toBe(2000);
    vi.useRealTimers();
  });

  it('returns undefined for invalid header', () => {
    expect(parseRetryAfter('not-a-date')).toBeUndefined();
  });
});

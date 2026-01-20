import { describe, expect, it, vi } from 'vitest';

import { createGraphClient, MetaGraphError, MetaGraphTimeoutError } from '../src/index.js';

describe('createGraphClient', () => {
  it('sends JSON body with auth header and parses response', async () => {
    const transport = vi.fn(async (_url, init?: RequestInit) => {
      const body = init?.body as string;
      expect(JSON.parse(body)).toEqual({ hello: 'world' });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    const client = createGraphClient({
      accessToken: 'token-123',
      apiVersion: 'v19.0',
      transport
    });

    const response = await client.post('123/messages', { hello: 'world' });

    expect(response.status).toBe(200);
    expect(response.data).toEqual({ ok: true });
    expect(transport).toHaveBeenCalledWith(
      'https://graph.facebook.com/v19.0/123/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer token-123', 'Content-Type': 'application/json' })
      })
    );
  });

  it('retries on 429 respecting Retry-After header', async () => {
    vi.useFakeTimers();
    const transport = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'rate limit', code: 4 } }), {
          status: 429,
          headers: { 'Retry-After': '1' }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      );

    const client = createGraphClient({
      accessToken: 'token-xyz',
      retry: { initialDelayMs: 10, maxDelayMs: 10, multiplier: 1, jitter: false, maxRetries: 2 },
      transport
    });

    const promise = client.post('123/messages', { text: 'hi' });

    await vi.runAllTimersAsync();
    const response = await promise;

    expect(response.status).toBe(200);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('wraps transport timeout errors', async () => {
    const timeoutError = new Error('timeout');
    (timeoutError as Error & { name: string }).name = 'AbortError';
    const transport = vi.fn(async () => {
      throw timeoutError;
    });

    const client = createGraphClient({
      accessToken: 'token',
      retry: { maxRetries: 0 },
      transport
    });

    await expect(client.post('123/messages', {})).rejects.toBeInstanceOf(MetaGraphTimeoutError);
  });

  it('throws MetaGraphError on non-retryable client errors without retry loop', async () => {
    const transport = vi.fn(async () => {
      return new Response(JSON.stringify({ error: { message: 'invalid param' } }), { status: 400 });
    });

    const client = createGraphClient({
      accessToken: 'token',
      retry: { maxRetries: 1 },
      transport
    });

    await expect(client.post('123/messages', {})).rejects.toBeInstanceOf(MetaGraphError);
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

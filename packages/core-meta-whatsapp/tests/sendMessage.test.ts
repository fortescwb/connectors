import { describe, expect, it, vi } from 'vitest';

import { MetaGraphError, MetaGraphTimeoutError } from '@connectors/core-meta-graph';
import type { OutboundMessageIntent } from '@connectors/core-messaging';

import { sendMessage } from '../src/sendMessage.js';

const makeIntent = (overrides: Partial<OutboundMessageIntent> = {}): OutboundMessageIntent => ({
  intentId: '550e8400-e29b-41d4-a716-446655440000',
  tenantId: 'tenant-1',
  provider: 'whatsapp',
  to: '+15551234567',
  payload: { type: 'text', text: 'hello world' },
  dedupeKey: 'whatsapp:tenant-1:client-1',
  correlationId: 'corr-123',
  createdAt: new Date().toISOString(),
  ...overrides
});

describe('sendMessage', () => {
  it('builds WhatsApp Graph payload and surfaces provider message id', async () => {
    const calls: Array<{ url: string; body?: string; headers?: HeadersInit }> = [];
    const transport = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body as string, headers: init?.headers });
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.TEST.1' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    const intent = makeIntent();
    const result = await sendMessage(intent, {
      accessToken: 'token-123',
      phoneNumberId: '12345',
      apiVersion: 'v19.0',
      transport,
      retry: { maxRetries: 0 }
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://graph.facebook.com/v19.0/12345/messages');
    const headers = calls[0]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token-123');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toMatchObject({
      messaging_product: 'whatsapp',
      to: intent.to,
      type: 'text',
      client_msg_id: intent.intentId,
      text: { body: intent.payload.text }
    });
    expect(result.providerMessageId).toBe('wamid.TEST.1');
  });

  it('throws for unsupported payload types', async () => {
    const intent = makeIntent({
      payload: { type: 'image', text: 'n/a' } as never
    });

    await expect(
      sendMessage(intent, {
        accessToken: 'token',
        phoneNumberId: '123',
        transport: async () => new Response(JSON.stringify({}), { status: 200 })
      })
    ).rejects.toThrow(/Unsupported payload type/);
  });

  it('includes preview_url when previewUrl is provided in payload', async () => {
    const calls: Array<{ body?: string }> = [];
    const transport = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ body: init?.body as string });
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.TEST.2' }] }), { status: 200 });
    });

    const intent = makeIntent({
      payload: { type: 'text', text: 'Check out this link', previewUrl: true }
    });

    await sendMessage(intent, {
      accessToken: 'token-abc',
      phoneNumberId: '67890',
      apiVersion: 'v19.0',
      transport,
      retry: { maxRetries: 0 }
    });

    expect(calls).toHaveLength(1);
    const body = JSON.parse(calls[0]?.body ?? '{}');
    expect(body.text).toMatchObject({ body: 'Check out this link', preview_url: true });
  });

  it('throws MetaGraphError for HTTP 4xx error responses', async () => {
    const transport = vi.fn(async () => {
      return new Response(JSON.stringify({ error: { message: 'Invalid phone number' } }), { status: 400 });
    });

    const intent = makeIntent();

    await expect(
      sendMessage(intent, {
        accessToken: 'token',
        phoneNumberId: '123',
        transport,
        retry: { maxRetries: 0 }
      })
    ).rejects.toBeInstanceOf(MetaGraphError);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('retries on 5xx then succeeds', async () => {
    vi.useFakeTimers();
    const responses = [
      new Response(JSON.stringify({ error: { message: 'Internal error' } }), { status: 500 }),
      new Response(JSON.stringify({ messages: [{ id: 'wamid.RETRY.SUCCESS' }] }), { status: 200 })
    ];
    const transport = vi.fn(async () => responses.shift()!);

    const intent = makeIntent();

    const promise = sendMessage(intent, {
      accessToken: 'token',
      phoneNumberId: '123',
      transport,
      retry: { initialDelayMs: 5, maxDelayMs: 5, multiplier: 1, jitter: false, maxRetries: 2 }
    });

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.providerMessageId).toBe('wamid.RETRY.SUCCESS');
    expect(transport).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('exposes timeout errors from transport', async () => {
    const transport = vi.fn(async () => {
      const err = new Error('timeout');
      (err as Error & { name: string }).name = 'AbortError';
      throw err;
    });

    const intent = makeIntent();

    await expect(
      sendMessage(intent, {
        accessToken: 'token',
        phoneNumberId: '123',
        transport,
        retry: { maxRetries: 0 }
      })
    ).rejects.toBeInstanceOf(MetaGraphTimeoutError);
  });

  it('handles malformed API responses (missing messages array)', async () => {
    const transport = vi.fn(async () => {
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    });

    const intent = makeIntent();

    const result = await sendMessage(intent, {
      accessToken: 'token',
      phoneNumberId: '123',
      transport,
      retry: { maxRetries: 0 }
    });

    expect(result.providerMessageId).toBeUndefined();
    expect(result.status).toBe(200);
  });

  it('handles empty response data', async () => {
    const transport = vi.fn(async () => {
      return new Response('', { status: 200 });
    });

    const intent = makeIntent();

    const result = await sendMessage(intent, {
      accessToken: 'token',
      phoneNumberId: '123',
      transport,
      retry: { maxRetries: 0 }
    });

    expect(result.providerMessageId).toBeUndefined();
    expect(result.status).toBe(200);
    expect(result.raw).toBeUndefined();
  });
});

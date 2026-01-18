import { describe, expect, it } from 'vitest';

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
    const calls: Array<Record<string, unknown>> = [];
    const httpClient = {
      post: async (url: string, body: unknown, options: { headers?: Record<string, string> }) => {
        calls.push({ url, body, headers: options.headers });
        return {
          status: 200,
          data: { messages: [{ id: 'wamid.TEST.1' }] }
        };
      }
    };

    const intent = makeIntent();
    const result = await sendMessage(intent, {
      accessToken: 'token-123',
      phoneNumberId: '12345',
      apiVersion: 'v19.0',
      httpClient
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://graph.facebook.com/v19.0/12345/messages');
    expect(calls[0]?.headers?.Authorization).toBe('Bearer token-123');
    expect(calls[0]?.body).toMatchObject({
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
        httpClient: {
          post: async () => ({ status: 200, data: {} })
        }
      })
    ).rejects.toThrow(/Unsupported payload type/);
  });

  it('includes preview_url when previewUrl is provided in payload', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const httpClient = {
      post: async (url: string, body: unknown, options: { headers?: Record<string, string> }) => {
        calls.push({ url, body, headers: options.headers });
        return {
          status: 200,
          data: { messages: [{ id: 'wamid.TEST.2' }] }
        };
      }
    };

    const intent = makeIntent({
      payload: { type: 'text', text: 'Check out this link', previewUrl: true }
    });

    await sendMessage(intent, {
      accessToken: 'token-abc',
      phoneNumberId: '67890',
      apiVersion: 'v19.0',
      httpClient
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toMatchObject({
      text: { body: 'Check out this link', preview_url: true }
    });
  });

  it('throws for HTTP 4xx error responses', async () => {
    const httpClient = {
      post: async () => ({
        status: 400,
        data: { error: { message: 'Invalid phone number' } }
      })
    };

    const intent = makeIntent();

    await expect(
      sendMessage(intent, {
        accessToken: 'token',
        phoneNumberId: '123',
        httpClient
      })
    ).rejects.toThrow(/WhatsApp send failed with status 400/);
  });

  it('throws for HTTP 5xx error responses', async () => {
    const httpClient = {
      post: async () => ({
        status: 500,
        data: { error: { message: 'Internal server error' } }
      })
    };

    const intent = makeIntent();

    await expect(
      sendMessage(intent, {
        accessToken: 'token',
        phoneNumberId: '123',
        httpClient
      })
    ).rejects.toThrow(/WhatsApp send failed with status 500/);
  });

  it('handles malformed API responses (missing messages array)', async () => {
    const httpClient = {
      post: async () => ({
        status: 200,
        data: { success: true } // Missing 'messages' array
      })
    };

    const intent = makeIntent();

    const result = await sendMessage(intent, {
      accessToken: 'token',
      phoneNumberId: '123',
      httpClient
    });

    expect(result.providerMessageId).toBeUndefined();
    expect(result.status).toBe(200);
  });

  it('handles empty response data', async () => {
    const httpClient = {
      post: async () => ({
        status: 200,
        data: null
      })
    };

    const intent = makeIntent();

    const result = await sendMessage(intent, {
      accessToken: 'token',
      phoneNumberId: '123',
      httpClient
    });

    expect(result.providerMessageId).toBeUndefined();
    expect(result.status).toBe(200);
    expect(result.raw).toBeNull();
  });
});

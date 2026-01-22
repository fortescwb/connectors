import { describe, expect, it, vi } from 'vitest';

import { MetaGraphError, MetaGraphTimeoutError } from '@connectors/core-meta-graph';
import type { OutboundMessageIntent } from '@connectors/core-messaging';

import { sendMessage, sendWhatsAppOutbound, markAsRead } from '../src/sendMessage.js';

import audioFixture from '../fixtures/outbound/example_audio_message.json';
import documentFixture from '../fixtures/outbound/example_document_message.json';
import contactsFixture from '../fixtures/outbound/example_contacts_message.json';
import reactionFixture from '../fixtures/outbound/example_reaction_message.json';
import templateFixture from '../fixtures/outbound/example_template_message.json';
import markReadFixture from '../fixtures/outbound/example_mark_read.json';

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

const makeIntentFromFixture = (fixture: { intent: OutboundMessageIntent }): OutboundMessageIntent => ({
  ...fixture.intent
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
        payload: { type: 'unsupported_foo' } as never
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

// ─────────────────────────────────────────────────────────────────────────────
// Testes por tipo de payload (usando fixtures reais)
// ─────────────────────────────────────────────────────────────────────────────

describe('sendMessage - audio payload', () => {
  it('builds correct API payload for audio message with mediaId', async () => {
    const calls: Array<{ body?: string }> = [];
    const transport = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ body: init?.body as string });
      return new Response(JSON.stringify(audioFixture.expectedResponse), { status: 200 });
    });

    const intent = makeIntentFromFixture(audioFixture as { intent: OutboundMessageIntent });

    const result = await sendMessage(intent, {
      accessToken: 'token-test',
      phoneNumberId: '12345',
      transport,
      retry: { maxRetries: 0 }
    });

    expect(calls).toHaveLength(1);
    const body = JSON.parse(calls[0]?.body ?? '{}');
    expect(body).toMatchObject({
      messaging_product: 'whatsapp',
      type: 'audio',
      audio: { id: (intent.payload as { mediaId?: string }).mediaId }
    });
    expect(result.providerMessageId).toBeDefined();
  });
});

describe('sendMessage - document payload', () => {
  it('builds correct API payload for document message with mediaUrl', async () => {
    const calls: Array<{ body?: string }> = [];
    const transport = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ body: init?.body as string });
      return new Response(JSON.stringify(documentFixture.expectedResponse), { status: 200 });
    });

    const intent = makeIntentFromFixture(documentFixture as { intent: OutboundMessageIntent });

    await sendMessage(intent, {
      accessToken: 'token-test',
      phoneNumberId: '12345',
      transport,
      retry: { maxRetries: 0 }
    });

    expect(calls).toHaveLength(1);
    const body = JSON.parse(calls[0]?.body ?? '{}');
    expect(body).toMatchObject({
      messaging_product: 'whatsapp',
      type: 'document',
      document: {
        link: (intent.payload as { mediaUrl?: string }).mediaUrl,
        filename: (intent.payload as { filename?: string }).filename,
        caption: (intent.payload as { caption?: string }).caption
      }
    });
  });
});

describe('sendMessage - video payload', () => {
  it('builds correct API payload for video message with mediaId', async () => {
    const calls: Array<{ body?: string }> = [];
    const transport = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ body: init?.body as string });
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.VIDEO' }] }), { status: 200 });
    });

    const intent = makeIntent({
      payload: {
        type: 'video',
        mediaId: 'media-video-123',
        caption: 'sample video'
      }
    });

    await sendMessage(intent, {
      accessToken: 'token-test',
      phoneNumberId: '12345',
      transport,
      retry: { maxRetries: 0 }
    });

    expect(calls).toHaveLength(1);
    const body = JSON.parse(calls[0]?.body ?? '{}');
    expect(body).toMatchObject({
      messaging_product: 'whatsapp',
      type: 'video',
      video: { id: 'media-video-123', caption: 'sample video' }
    });
  });
});

describe('sendMessage - sticker payload', () => {
  it('builds correct API payload for sticker message with mediaUrl', async () => {
    const calls: Array<{ body?: string }> = [];
    const transport = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ body: init?.body as string });
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.STICKER' }] }), { status: 200 });
    });

    const intent = makeIntent({
      payload: {
        type: 'sticker',
        mediaUrl: 'https://example.com/sticker.webp'
      }
    });

    await sendMessage(intent, {
      accessToken: 'token-test',
      phoneNumberId: '12345',
      transport,
      retry: { maxRetries: 0 }
    });

    expect(calls).toHaveLength(1);
    const body = JSON.parse(calls[0]?.body ?? '{}');
    expect(body).toMatchObject({
      messaging_product: 'whatsapp',
      type: 'sticker',
      sticker: { link: 'https://example.com/sticker.webp' }
    });
  });
});

describe('sendMessage - contacts payload', () => {
  it('builds correct API payload for contacts message', async () => {
    const calls: Array<{ body?: string }> = [];
    const transport = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ body: init?.body as string });
      return new Response(JSON.stringify(contactsFixture.expectedResponse), { status: 200 });
    });

    const intent = makeIntentFromFixture(contactsFixture as { intent: OutboundMessageIntent });

    await sendMessage(intent, {
      accessToken: 'token-test',
      phoneNumberId: '12345',
      transport,
      retry: { maxRetries: 0 }
    });

    expect(calls).toHaveLength(1);
    const body = JSON.parse(calls[0]?.body ?? '{}');
    expect(body.type).toBe('contacts');
    expect(body.contacts).toHaveLength(1);
    expect(body.contacts[0].name).toMatchObject({ formatted_name: 'John Doe' });
  });
});

describe('sendMessage - reaction payload', () => {
  it('builds correct API payload for reaction message', async () => {
    const calls: Array<{ body?: string }> = [];
    const transport = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ body: init?.body as string });
      return new Response(JSON.stringify(reactionFixture.expectedResponse), { status: 200 });
    });

    const intent = makeIntentFromFixture(reactionFixture as { intent: OutboundMessageIntent });

    await sendMessage(intent, {
      accessToken: 'token-test',
      phoneNumberId: '12345',
      transport,
      retry: { maxRetries: 0 }
    });

    expect(calls).toHaveLength(1);
    const body = JSON.parse(calls[0]?.body ?? '{}');
    expect(body).toMatchObject({
      messaging_product: 'whatsapp',
      type: 'reaction',
      reaction: {
        message_id: (intent.payload as { messageId: string }).messageId,
        emoji: (intent.payload as { emoji: string }).emoji
      }
    });
  });
});

describe('sendMessage - location payload', () => {
  it('builds correct API payload for fixed location', async () => {
    const calls: Array<{ body?: string }> = [];
    const transport = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ body: init?.body as string });
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.LOC.FIXED' }] }), { status: 200 });
    });

    const intent = makeIntent({
      payload: {
        type: 'location',
        latitude: -23.55052,
        longitude: -46.633308,
        name: 'São Paulo',
        address: 'SP, Brasil'
      }
    });

    await sendMessage(intent, {
      accessToken: 'token-test',
      phoneNumberId: '12345',
      transport,
      retry: { maxRetries: 0 }
    });

    expect(calls).toHaveLength(1);
    const body = JSON.parse(calls[0]?.body ?? '{}');
    expect(body).toMatchObject({
      messaging_product: 'whatsapp',
      type: 'location',
      location: {
        latitude: -23.55052,
        longitude: -46.633308,
        name: 'São Paulo',
        address: 'SP, Brasil'
      }
    });
  });
});

describe('sendMessage - template payload', () => {
  it('builds correct API payload for template message', async () => {
    const calls: Array<{ body?: string }> = [];
    const transport = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ body: init?.body as string });
      return new Response(JSON.stringify(templateFixture.expectedResponse), { status: 200 });
    });

    const intent = makeIntentFromFixture(templateFixture as { intent: OutboundMessageIntent });

    await sendMessage(intent, {
      accessToken: 'token-test',
      phoneNumberId: '12345',
      transport,
      retry: { maxRetries: 0 }
    });

    expect(calls).toHaveLength(1);
    const body = JSON.parse(calls[0]?.body ?? '{}');
    expect(body.type).toBe('template');
    expect(body.template).toMatchObject({
      name: (intent.payload as { templateName: string }).templateName,
      language: { code: (intent.payload as { languageCode: string }).languageCode }
    });
    expect(body.template.components).toHaveLength(1);
  });
});

describe('markAsRead', () => {
  it('sends correct read receipt payload', async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    const transport = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body as string });
      return new Response(JSON.stringify(markReadFixture.expectedResponse), { status: 200 });
    });

    const result = await markAsRead(markReadFixture.messageId, {
      accessToken: 'token-test',
      phoneNumberId: '12345',
      transport,
      retry: { maxRetries: 0 }
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('/messages');
    const body = JSON.parse(calls[0]?.body ?? '{}');
    expect(body).toMatchObject({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: markReadFixture.messageId
    });
    expect(result.success).toBe(true);
  });

  it('returns success false on failed mark read', async () => {
    const transport = vi.fn(async () => {
      return new Response(JSON.stringify({ success: false }), { status: 200 });
    });

    const result = await markAsRead('some-message-id', {
      accessToken: 'token',
      phoneNumberId: '123',
      transport,
      retry: { maxRetries: 0 }
    });

    expect(result.success).toBe(false);
  });
});

describe('sendWhatsAppOutbound', () => {
  it('routes mark_read payloads through markAsRead without duplicating logic', async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    const transport = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body as string });
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    });

    const intent: OutboundMessageIntent = {
      ...makeIntent(),
      payload: { type: 'mark_read', messageId: 'wamid.TEST.READ' }
    };

    const result = await sendWhatsAppOutbound(intent, {
      accessToken: 'token-test',
      phoneNumberId: '12345',
      transport,
      retry: { maxRetries: 0 }
    });

    expect(calls).toHaveLength(1);
    const body = JSON.parse(calls[0]?.body ?? '{}');
    expect(body).toMatchObject({ status: 'read', message_id: 'wamid.TEST.READ' });
    expect((result as { success?: boolean }).success).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Retry and error handling tests for all message types
  // ─────────────────────────────────────────────────────────────────────────
  it.each(['audio', 'document', 'contacts', 'reaction', 'template', 'video', 'sticker'])(
    '%s: retries on 5xx then succeeds without duplicating side-effect',
    async (type) => {
      vi.useFakeTimers();
      const fixture = type === 'audio' ? audioFixture :
                      type === 'document' ? documentFixture :
                      type === 'contacts' ? contactsFixture :
                      type === 'reaction' ? reactionFixture :
                      type === 'video' ? { intent: makeIntent({ payload: { type: 'video', mediaUrl: 'https://example.com/video.mp4' } }), expectedResponse: { messages: [{ id: 'wamid.VIDEO.RETRY' }] } } :
                      type === 'sticker' ? { intent: makeIntent({ payload: { type: 'sticker', mediaId: 'media-sticker-1' } }), expectedResponse: { messages: [{ id: 'wamid.STICKER.RETRY' }] } } :
                      templateFixture;

      const responses = [
        new Response(JSON.stringify({ error: { message: 'Internal error' } }), { status: 500 }),
        new Response(JSON.stringify(fixture.expectedResponse), { status: 200 })
      ];
      const transport = vi.fn(async () => responses.shift()!);

      const intent = makeIntentFromFixture(fixture as { intent: OutboundMessageIntent });

      const promise = sendMessage(intent, {
        accessToken: 'token-test',
        phoneNumberId: '12345',
        transport,
        retry: { initialDelayMs: 5, maxDelayMs: 5, multiplier: 1, jitter: false, maxRetries: 2 }
      });

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.providerMessageId).toBeDefined();
      expect(transport).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    }
  );

  it('audio payload correctly handles mediaUrl (link) instead of mediaId', async () => {
    const calls: Array<{ body?: string }> = [];
    const transport = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ body: init?.body as string });
      return new Response(JSON.stringify(audioFixture.expectedResponse), { status: 200 });
    });

    const intent = makeIntent({
      payload: {
        type: 'audio',
        mediaUrl: 'https://example.com/audio.mp3'
      }
    });

    await sendMessage(intent, {
      accessToken: 'token-test',
      phoneNumberId: '12345',
      transport,
      retry: { maxRetries: 0 }
    });

    expect(calls).toHaveLength(1);
    const body = JSON.parse(calls[0]?.body ?? '{}');
    expect(body.audio).toMatchObject({ link: 'https://example.com/audio.mp3' });
  });

  it('document payload correctly includes filename and caption when provided', async () => {
    const calls: Array<{ body?: string }> = [];
    const transport = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ body: init?.body as string });
      return new Response(JSON.stringify(documentFixture.expectedResponse), { status: 200 });
    });

    const intent = makeIntent({
      payload: {
        type: 'document',
        mediaUrl: 'https://example.com/file.pdf',
        filename: 'contract.pdf',
        caption: 'Please review'
      }
    });

    await sendMessage(intent, {
      accessToken: 'token-test',
      phoneNumberId: '12345',
      transport,
      retry: { maxRetries: 0 }
    });

    expect(calls).toHaveLength(1);
    const body = JSON.parse(calls[0]?.body ?? '{}');
    expect(body.document).toMatchObject({
      link: 'https://example.com/file.pdf',
      filename: 'contract.pdf',
      caption: 'Please review'
    });
  });

  it('template payload correctly handles multiple components and parameters', async () => {
    const calls: Array<{ body?: string }> = [];
    const transport = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ body: init?.body as string });
      return new Response(JSON.stringify(templateFixture.expectedResponse), { status: 200 });
    });

    const intent = makeIntent({
      payload: {
        type: 'template',
        templateName: 'order_status',
        languageCode: 'pt_BR',
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'ABC123' },
              { type: 'text', text: 'Confirmado' }
            ]
          }
        ]
      }
    });

    await sendMessage(intent, {
      accessToken: 'token-test',
      phoneNumberId: '12345',
      transport,
      retry: { maxRetries: 0 }
    });

    expect(calls).toHaveLength(1);
    const body = JSON.parse(calls[0]?.body ?? '{}');
    expect(body.template).toMatchObject({
      name: 'order_status',
      language: { code: 'pt_BR' }
    });
    expect(body.template.components[0].parameters).toHaveLength(2);
  });

  it('reaction payload correctly targets specific message and uses emoji', async () => {
    const calls: Array<{ body?: string }> = [];
    const transport = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ body: init?.body as string });
      return new Response(JSON.stringify(reactionFixture.expectedResponse), { status: 200 });
    });

    const intent = makeIntent({
      payload: {
        type: 'reaction',
        messageId: 'wamid.TARGET.MESSAGE.ID',
        emoji: '👍'
      }
    });

    await sendMessage(intent, {
      accessToken: 'token-test',
      phoneNumberId: '12345',
      transport,
      retry: { maxRetries: 0 }
    });

    expect(calls).toHaveLength(1);
    const body = JSON.parse(calls[0]?.body ?? '{}');
    expect(body.reaction).toMatchObject({
      message_id: 'wamid.TARGET.MESSAGE.ID',
      emoji: '👍'
    });
  });

  it('contacts payload includes multiple contacts with phones and emails', async () => {
    const calls: Array<{ body?: string }> = [];
    const transport = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ body: init?.body as string });
      return new Response(JSON.stringify(contactsFixture.expectedResponse), { status: 200 });
    });

    const intent = makeIntent({
      payload: {
        type: 'contacts',
        contacts: [
          {
            name: {
              formatted_name: 'Alice Smith',
              first_name: 'Alice',
              last_name: 'Smith'
            },
            phones: [
              { phone: '+15551112222', type: 'CELL' },
              { phone: '+15553334444', type: 'WORK' }
            ],
            emails: [
              { email: 'alice@example.com', type: 'WORK' }
            ]
          }
        ]
      }
    });

    await sendMessage(intent, {
      accessToken: 'token-test',
      phoneNumberId: '12345',
      transport,
      retry: { maxRetries: 0 }
    });

    expect(calls).toHaveLength(1);
    const body = JSON.parse(calls[0]?.body ?? '{}');
    expect(body.contacts).toHaveLength(1);
    expect(body.contacts[0]).toHaveProperty('phones');
    expect(body.contacts[0].phones).toHaveLength(2);
    expect(body.contacts[0].emails).toHaveLength(1);
  });

  it('all message types include client_msg_id for idempotency', async () => {
    const fixtures = [audioFixture, documentFixture, contactsFixture, reactionFixture, templateFixture];
    
    for (const fixture of fixtures) {
      const calls: Array<{ body?: string }> = [];
      const transport = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ body: init?.body as string });
        return new Response(JSON.stringify(fixture.expectedResponse), { status: 200 });
      });

      const intent = makeIntentFromFixture(fixture as { intent: OutboundMessageIntent });

      await sendMessage(intent, {
        accessToken: 'token-test',
        phoneNumberId: '12345',
        transport,
        retry: { maxRetries: 0 }
      });

      expect(calls).toHaveLength(1);
      const body = JSON.parse(calls[0]?.body ?? '{}');
      expect(body.client_msg_id).toBe(intent.intentId);
    }
  });
});

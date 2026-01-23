import { describe, expect, it } from 'vitest';

import {
  InstagramOutboundMessageIntentSchema,
  buildInstagramOutboundDedupeKey,
  buildInstagramOutboundDmDedupeKey,
  InstagramInboundMessageEventSchema,
  buildInstagramInboundDedupeKey
} from '../src/index.js';

const baseOutboundIntent = {
  intentId: '550e8400-e29b-41d4-a716-446655440000',
  clientMessageId: 'client-msg-ig-001',
  tenantId: 'tenant-ig-123',
  provider: 'instagram' as const,
  to: '17890000000000000',
  payload: { type: 'text' as const, text: 'hello via ig dm' },
  dedupeKey: 'instagram:tenant:tenant-ig-123:intent:550e8400-e29b-41d4-a716-446655440000',
  correlationId: 'corr-ig-1',
  createdAt: new Date().toISOString()
};

describe('InstagramOutboundMessageIntentSchema', () => {
  it('accepts a valid text intent', () => {
    const parsed = InstagramOutboundMessageIntentSchema.parse(baseOutboundIntent);
    expect(parsed.provider).toBe('instagram');
  });

  it('accepts a link payload with url', () => {
    const parsed = InstagramOutboundMessageIntentSchema.parse({
      ...baseOutboundIntent,
      payload: { type: 'link' as const, url: 'https://example.com/docs', text: 'check docs' }
    });
    expect(parsed.payload.type).toBe('link');
  });

  it('rejects media payloads without mediaId or url', () => {
    expect(() =>
      InstagramOutboundMessageIntentSchema.parse({
        ...baseOutboundIntent,
        payload: { type: 'image', caption: 'no source' }
      })
    ).toThrow(/mediaId or url/);
  });

  it('requires clientMessageId', () => {
    expect(() =>
      InstagramOutboundMessageIntentSchema.parse({
        ...baseOutboundIntent,
        clientMessageId: undefined
      })
    ).toThrow(/clientMessageId/);
  });
});

describe('Instagram inbound message schema', () => {
  it('normalizes numeric timestamps to ISO strings', () => {
    const event = InstagramInboundMessageEventSchema.parse({
      provider: 'instagram',
      channel: 'instagram_dm',
      from: 'user-1',
      to: 'page-1',
      messageId: 'm_123',
      timestamp: 1737300000123,
      payload: { type: 'text', text: 'hi' },
      dedupeKey: 'instagram:page-1:msg:m_123'
    });

    expect(event.timestamp).toMatch(/T/);
  });

  it('rejects inbound media without id or url', () => {
    expect(() =>
      InstagramInboundMessageEventSchema.parse({
        provider: 'instagram',
        channel: 'instagram_dm',
        from: 'user-1',
        to: 'page-1',
        messageId: 'm_124',
        timestamp: 1737300000456,
        payload: { type: 'video', caption: 'missing source' },
        dedupeKey: 'instagram:page-1:msg:m_124'
      })
    ).toThrow(/id or url/);
  });
});

describe('Instagram dedupe key builders', () => {
  it('builds outbound dedupe key without PII', () => {
    const key = buildInstagramOutboundDedupeKey('tenant-x', 'intent-y');
    expect(key).toBe('instagram:tenant:tenant-x:intent:intent-y');
  });

  it('builds outbound DM dedupe key using recipient + clientMessageId', () => {
    const key = buildInstagramOutboundDmDedupeKey('17890000000000000', 'client-msg-1');
    expect(key).toBe('instagram:outbound:dm:17890000000000000:client-msg-1');
  });

  it('builds inbound dedupe key', () => {
    const key = buildInstagramInboundDedupeKey('page-123', 'mid-456');
    expect(key).toBe('instagram:page-123:msg:mid-456');
  });
});

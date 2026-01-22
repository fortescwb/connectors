import { describe, expect, it } from 'vitest';

import type { InstagramOutboundMessageIntent } from '@connectors/core-messaging';

import { buildInstagramMessagePayload } from '../src/outbound/buildPayload.js';

const baseIntent: InstagramOutboundMessageIntent = {
  intentId: '550e8400-e29b-41d4-a716-446655440000',
  tenantId: 'tenant-ig-123',
  provider: 'instagram',
  to: '17890000000000000',
  payload: { type: 'text', text: 'hello ig' },
  dedupeKey: 'instagram:tenant:tenant-ig-123:intent:550e8400-e29b-41d4-a716-446655440000',
  correlationId: 'corr-1',
  createdAt: new Date().toISOString()
};

describe('buildInstagramMessagePayload', () => {
  it('builds text payload with messaging_type RESPONSE', () => {
    const payload = buildInstagramMessagePayload(baseIntent);
    expect(payload.messaging_type).toBe('RESPONSE');
    expect(payload.recipient).toEqual({ id: baseIntent.to });
    expect(payload.message).toEqual({ text: 'hello ig' });
  });

  it('builds link payload concatenating url and text', () => {
    const intent: InstagramOutboundMessageIntent = {
      ...baseIntent,
      payload: { type: 'link', url: 'https://example.com/info', text: 'see more' }
    };
    const payload = buildInstagramMessagePayload(intent);
    expect(payload.message).toEqual({ text: 'see more https://example.com/info' });
  });

  it('builds image payload preferring attachmentId override', () => {
    const intent: InstagramOutboundMessageIntent = {
      ...baseIntent,
      payload: { type: 'image', url: 'https://example.com/img.jpg', caption: 'caption' }
    };
    const payload = buildInstagramMessagePayload(intent, { attachmentId: 'att_123' });
    expect(payload.message).toEqual({
      attachment: { type: 'image', payload: { attachment_id: 'att_123' } },
      text: 'caption'
    });
  });

  it('throws when media is missing source', () => {
    const intent: InstagramOutboundMessageIntent = {
      ...baseIntent,
      payload: { type: 'video', caption: 'no source' }
    } as unknown as InstagramOutboundMessageIntent;

    expect(() => buildInstagramMessagePayload(intent)).toThrow(/Media payload requires attachmentId or url/);
  });
});

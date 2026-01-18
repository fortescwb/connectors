import { describe, expect, it } from 'vitest';

import { OutboundMessageIntentSchema } from '../src/outbound/OutboundMessageIntent.js';

const baseIntent = {
  intentId: '550e8400-e29b-41d4-a716-446655440000',
  tenantId: 'tenant-123',
  provider: 'whatsapp' as const,
  to: '+15551234567',
  payload: {
    type: 'text' as const,
    text: 'Hello!'
  },
  dedupeKey: 'whatsapp:tenant-123:client-msg-1',
  correlationId: 'corr-abc',
  createdAt: new Date().toISOString()
};

describe('OutboundMessageIntentSchema', () => {
  it('accepts a valid text intent (UUID)', () => {
    const result = OutboundMessageIntentSchema.parse(baseIntent);
    expect(result.intentId).toBe(baseIntent.intentId);
  });

  it('accepts ULID identifiers', () => {
    const ulidIntent = {
      ...baseIntent,
      intentId: '01H9Z7W9XKCEQ3FJ8BG8D4N9QM'
    };

    const result = OutboundMessageIntentSchema.parse(ulidIntent);
    expect(result.intentId).toBe(ulidIntent.intentId);
  });

  it('rejects invalid phone numbers (non E.164)', () => {
    expect(() =>
      OutboundMessageIntentSchema.parse({
        ...baseIntent,
        to: '1234' // too short / missing country code
      })
    ).toThrow(/E\.164/);
  });

  it('rejects non-whatsapp providers', () => {
    expect(() =>
      OutboundMessageIntentSchema.parse({
        ...baseIntent,
        provider: 'instagram' as never
      })
    ).toThrow(/whatsapp/);
  });

  it('requires dedupeKey and correlationId', () => {
    expect(() =>
      OutboundMessageIntentSchema.parse({
        ...baseIntent,
        dedupeKey: '',
        correlationId: ''
      })
    ).toThrow();
  });

  it('rejects empty text payloads', () => {
    expect(() =>
      OutboundMessageIntentSchema.parse({
        ...baseIntent,
        payload: { type: 'text' as const, text: '' }
      })
    ).toThrow(/text must not be empty/);
  });
});

import { describe, expect, it, vi } from 'vitest';

import type { GraphClient } from '@connectors/core-meta-graph';
import type { InstagramOutboundMessageIntent } from '@connectors/core-messaging';

import { sendInstagramMessage } from '../src/outbound/sendMessage.js';

const baseIntent: InstagramOutboundMessageIntent = {
  intentId: '550e8400-e29b-41d4-a716-446655440000',
  clientMessageId: 'client-msg-ig-001',
  tenantId: 'tenant-ig-123',
  provider: 'instagram',
  to: '17890000000000000',
  payload: { type: 'text', text: 'hello ig outbound' },
  dedupeKey: 'instagram:outbound:dm:17890000000000000:client-msg-ig-001',
  correlationId: 'corr-outbound-1',
  createdAt: new Date().toISOString()
};

describe('sendInstagramMessage logging is PII-safe for outbound', () => {
  it('logs only metadata (no body/recipient/text/token)', async () => {
    const postMock = vi.fn(async () => ({ status: 200, headers: {}, data: { message_id: 'mid_123' } }));
    const graphClient: GraphClient = { request: vi.fn(), post: postMock } as unknown as GraphClient;

    const infoSpy = vi.fn();
    const warnSpy = vi.fn();
    const errorSpy = vi.fn();
    const logger = { info: infoSpy, warn: warnSpy, error: errorSpy } as any;

    await sendInstagramMessage(baseIntent, {
      accessToken: 'token-123',
      instagramBusinessAccountId: '1789',
      graphClient,
      logger
    });

    // Logger should be called with metadata only
    expect(infoSpy).toHaveBeenCalled();
    const payloads = infoSpy.mock.calls.map(([, meta]) => JSON.stringify(meta));

    for (const msg of payloads) {
      expect(msg.includes('hello ig outbound')).toBe(false); // no text content
      expect(msg.includes('token-123')).toBe(false); // no token
    }

    // Dedup/log metadata should be present
    const combined = payloads.join(' ');
    expect(combined).toContain('corr-outbound-1');
    expect(combined).toContain('instagram:outbound:dm:17890000000000000:client-msg-ig-001');
    expect(combined).toContain('mid_123');
    expect(combined).toContain('text');
  });
});

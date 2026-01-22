import { describe, expect, it, vi } from 'vitest';

import type { GraphClient } from '@connectors/core-meta-graph';
import type { InstagramOutboundMessageIntent } from '@connectors/core-messaging';

import { sendInstagramMessage } from '../src/outbound/sendMessage.js';

const baseIntent: InstagramOutboundMessageIntent = {
  intentId: '550e8400-e29b-41d4-a716-446655440000',
  tenantId: 'tenant-ig-123',
  provider: 'instagram',
  to: '17890000000000000',
  payload: { type: 'text', text: 'hello ig outbound' },
  dedupeKey: 'instagram:tenant:tenant-ig-123:intent:550e8400-e29b-41d4-a716-446655440000',
  correlationId: 'corr-outbound-1',
  createdAt: new Date().toISOString()
};

describe('sendInstagramMessage', () => {
  it('sends text message using provided graph client', async () => {
    const postMock = vi.fn(async (_path: string, body: unknown) => {
      return {
        status: 200,
        headers: {},
        data: { message_id: 'mid_123', echoed: body }
      };
    });

    const graphClient: GraphClient = {
      request: vi.fn(async () => ({ status: 200, headers: {}, data: {} })),
      post: postMock
    };

    const result = await sendInstagramMessage(baseIntent, {
      accessToken: 'fake-token',
      instagramBusinessAccountId: '1789',
      graphClient
    });

    expect(postMock).toHaveBeenCalledWith(
      '1789/messages',
      expect.objectContaining({
        messaging_type: 'RESPONSE',
        recipient: { id: baseIntent.to }
      }),
      expect.anything()
    );
    expect(result.providerMessageId).toBe('mid_123');
  });
});

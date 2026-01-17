import { describe, expect, it } from 'vitest';

import { ValidationError } from '@connectors/core-validation';
import type { TenantId } from '@connectors/core-tenant';

import {
  EVENT_TYPES,
  makeConversationMessageReceived,
  makeConversationMessageStatusUpdated,
  parseEventEnvelope
} from '../src/index.js';

const tenantId = 'tenant-123' as TenantId;

describe('event envelopes', () => {
  it('validates and returns a valid envelope', () => {
    const envelope = makeConversationMessageReceived({
      tenantId,
      source: 'test-suite',
      payload: {
        channel: 'whatsapp',
        externalMessageId: 'msg-1',
        conversationId: 'conv-1',
        direction: 'inbound',
        sender: { id: 'contact-1', name: 'Contact' },
        recipient: { id: 'agent-1' },
        content: { type: 'text', text: 'Hello' }
      }
    });

    const parsed = parseEventEnvelope(envelope);
    expect(parsed.eventId).toBeDefined();
    expect(parsed.dedupeKey).toBe('whatsapp:msg-1');
    expect(parsed.eventType).toBe(EVENT_TYPES.ConversationMessageReceived);
    expect(parsed.payload.content).toEqual({ type: 'text', text: 'Hello' });
  });

  it('rejects an invalid envelope', () => {
    const invalidEnvelope = {
      eventType: EVENT_TYPES.ConversationMessageReceived,
      payload: {},
      tenantId
    };

    expect(() => parseEventEnvelope(invalidEnvelope)).toThrow(ValidationError);
  });

  it('parses discriminated union by eventType', () => {
    const envelope = makeConversationMessageStatusUpdated({
      tenantId,
      source: 'test-suite',
      payload: {
        channel: 'whatsapp',
        externalMessageId: 'msg-2',
        conversationId: 'conv-1',
        status: 'sent',
        providerStatus: 'SENT'
      }
    });

    const parsed = parseEventEnvelope(envelope);
    expect(parsed.eventType).toBe(EVENT_TYPES.ConversationMessageStatusUpdated);
    expect(parsed.payload.status).toBe('sent');
    expect(parsed.dedupeKey).toBe('whatsapp:msg-2');
  });
});

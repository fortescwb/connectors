import { describe, expect, it } from 'vitest';

import { ValidationError } from '@connectors/core-validation';
import type { TenantId } from '@connectors/core-tenant';

import {
  EVENT_TYPES,
  makeCommentReceived,
  makeConversationMessageReceived,
  makeConversationMessageStatusUpdated,
  makeLeadCaptured,
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

  it('creates CommentReceived event with correct dedupe key', () => {
    const envelope = makeCommentReceived({
      tenantId,
      source: 'instagram-webhook',
      payload: {
        channel: 'instagram',
        externalCommentId: 'comment-12345',
        externalPostId: 'media-67890',
        author: {
          externalUserId: 'user-111',
          displayName: 'Jane Doe',
          username: 'janedoe'
        },
        content: {
          type: 'text',
          text: 'Great post! 🔥'
        },
        isReply: false,
        isHidden: false
      }
    });

    const parsed = parseEventEnvelope(envelope);
    expect(parsed.eventType).toBe(EVENT_TYPES.CommentReceived);
    expect(parsed.dedupeKey).toBe('instagram:comment-12345');
    if (parsed.eventType === EVENT_TYPES.CommentReceived) {
      expect(parsed.payload.author.username).toBe('janedoe');
      expect(parsed.payload.content.text).toBe('Great post! 🔥');
    }
  });

  it('creates CommentReceived reply event with parent reference', () => {
    const envelope = makeCommentReceived({
      tenantId,
      source: 'instagram-webhook',
      payload: {
        channel: 'instagram',
        externalCommentId: 'reply-999',
        externalPostId: 'media-67890',
        parentCommentId: 'comment-12345',
        author: {
          externalUserId: 'user-222',
          displayName: 'John Smith'
        },
        content: {
          type: 'text',
          text: 'Thanks!'
        },
        isReply: true,
        isHidden: false
      }
    });

    const parsed = parseEventEnvelope(envelope);
    expect(parsed.eventType).toBe(EVENT_TYPES.CommentReceived);
    if (parsed.eventType === EVENT_TYPES.CommentReceived) {
      expect(parsed.payload.parentCommentId).toBe('comment-12345');
      expect(parsed.payload.isReply).toBe(true);
    }
  });

  it('creates LeadCaptured event with correct dedupe key', () => {
    const envelope = makeLeadCaptured({
      tenantId,
      source: 'instagram-lead-ads',
      payload: {
        channel: 'instagram',
        leadId: 'internal-lead-001',
        externalLeadId: 'meta-lead-12345',
        contact: {
          name: 'Alice Johnson',
          email: 'alice@example.com',
          phone: '+5511999999999'
        },
        sourceContext: {
          campaign: 'summer-sale',
          medium: 'lead_ad'
        }
      }
    });

    const parsed = parseEventEnvelope(envelope);
    expect(parsed.eventType).toBe(EVENT_TYPES.LeadCaptured);
    expect(parsed.dedupeKey).toBe('instagram:meta-lead-12345');
    if (parsed.eventType === EVENT_TYPES.LeadCaptured) {
      expect(parsed.payload.contact.email).toBe('alice@example.com');
      expect(parsed.payload.sourceContext?.campaign).toBe('summer-sale');
    }
  });

  it('uses leadId for dedupe when externalLeadId missing', () => {
    const envelope = makeLeadCaptured({
      tenantId,
      source: 'manual-entry',
      payload: {
        channel: 'crm',
        leadId: 'internal-lead-002',
        contact: {
          name: 'Bob Wilson'
        }
      }
    });

    const parsed = parseEventEnvelope(envelope);
    expect(parsed.dedupeKey).toBe('crm:internal-lead-002');
  });
});

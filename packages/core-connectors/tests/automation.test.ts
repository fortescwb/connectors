import { describe, expect, it } from 'vitest';

import {
  AutomationTriggerEventSchema,
  AutomationSubscriptionSchema,
  CreateSubscriptionRequestSchema,
  CreateSubscriptionResponseSchema,
  UpdateSubscriptionRequestSchema,
  UpdateSubscriptionResponseSchema,
  DeleteSubscriptionRequestSchema,
  DeleteSubscriptionResponseSchema,
  DeliveryAttemptSchema,
  parseAutomationTriggerEvent,
  parseAutomationSubscription,
  buildAutomationEventDedupeKey,
  createAutomationTriggerEvent,
  isSubscriptionActive,
  subscriptionMatchesEvent,
  type AutomationTriggerEvent,
  type AutomationSubscription
} from '../src/index.js';

describe('automation contracts', () => {
  const validTriggerEvent: AutomationTriggerEvent = {
    id: 'evt-123',
    type: 'message.received',
    occurredAt: '2026-01-17T12:00:00Z',
    source: 'whatsapp',
    tenantId: 'tenant-456',
    correlationId: 'corr-789',
    payload: {
      messageId: 'msg-001',
      from: '+5511999999999',
      body: 'Hello world'
    },
    metadata: {
      schemaVersion: '1.0',
      priority: 'normal',
      tags: ['vip', 'urgent'],
      extra: { region: 'latam' }
    }
  };

  const validSubscription: AutomationSubscription = {
    id: 'sub-123',
    name: 'Zapier Integration',
    eventTypes: ['message.received', 'lead.captured'],
    targetUrl: 'https://hooks.zapier.com/abc123',
    httpMethod: 'POST',
    secret: 'webhook-secret-xyz',
    status: 'active',
    tenantId: 'tenant-456',
    filters: {
      sources: ['whatsapp', 'instagram'],
      tags: ['vip']
    },
    delivery: {
      maxRetries: 3,
      timeoutSeconds: 30,
      headers: { 'X-Custom-Header': 'value' }
    },
    createdAt: '2026-01-15T08:00:00Z',
    updatedAt: '2026-01-16T10:00:00Z'
  };

  describe('AutomationTriggerEventSchema', () => {
    it('parses a valid trigger event', () => {
      const result = AutomationTriggerEventSchema.parse(validTriggerEvent);
      expect(result.id).toBe('evt-123');
      expect(result.type).toBe('message.received');
      expect(result.source).toBe('whatsapp');
    });

    it('parses minimal trigger event with defaults', () => {
      const minimal = {
        id: 'evt-456',
        type: 'custom' as const,
        occurredAt: '2026-01-17T12:00:00Z',
        source: 'custom-integration',
        payload: { data: 'test' }
      };
      const result = AutomationTriggerEventSchema.parse(minimal);
      expect(result.metadata.schemaVersion).toBe('1.0');
      expect(result.metadata.priority).toBe('normal');
      expect(result.metadata.tags).toEqual([]);
    });

    it('accepts all standard event types', () => {
      const eventTypes = [
        'message.received',
        'message.sent',
        'message.status_updated',
        'contact.created',
        'contact.updated',
        'contact.deleted',
        'conversation.created',
        'conversation.updated',
        'conversation.closed',
        'comment.received',
        'comment.replied',
        'reaction.received',
        'lead.captured',
        'lead.qualified',
        'calendar.event_created',
        'calendar.event_updated',
        'calendar.event_deleted',
        'calendar.event_reminder',
        'custom'
      ] as const;

      for (const type of eventTypes) {
        const event = { ...validTriggerEvent, type };
        const result = AutomationTriggerEventSchema.parse(event);
        expect(result.type).toBe(type);
      }
    });

    it('accepts custom event type with customType field', () => {
      const event = {
        ...validTriggerEvent,
        type: 'custom' as const,
        customType: 'my.custom.event'
      };
      const result = AutomationTriggerEventSchema.parse(event);
      expect(result.type).toBe('custom');
      expect(result.customType).toBe('my.custom.event');
    });

    it('accepts priority levels', () => {
      const priorities = ['low', 'normal', 'high'] as const;
      for (const priority of priorities) {
        const event = {
          ...validTriggerEvent,
          metadata: { ...validTriggerEvent.metadata, priority }
        };
        const result = AutomationTriggerEventSchema.parse(event);
        expect(result.metadata.priority).toBe(priority);
      }
    });

    it('throws on invalid event type', () => {
      const invalid = { ...validTriggerEvent, type: 'invalid.type' };
      expect(() => AutomationTriggerEventSchema.parse(invalid)).toThrow();
    });

    it('throws on invalid occurredAt', () => {
      const invalid = { ...validTriggerEvent, occurredAt: 'not-a-date' };
      expect(() => AutomationTriggerEventSchema.parse(invalid)).toThrow();
    });
  });

  describe('AutomationSubscriptionSchema', () => {
    it('parses a valid subscription', () => {
      const result = AutomationSubscriptionSchema.parse(validSubscription);
      expect(result.id).toBe('sub-123');
      expect(result.eventTypes).toContain('message.received');
      expect(result.targetUrl).toBe('https://hooks.zapier.com/abc123');
    });

    it('parses minimal subscription with defaults', () => {
      const minimal = {
        id: 'sub-456',
        eventTypes: ['lead.captured'] as const,
        targetUrl: 'https://example.com/webhook'
      };
      const result = AutomationSubscriptionSchema.parse(minimal);
      expect(result.httpMethod).toBe('POST');
      expect(result.status).toBe('active');
      expect(result.delivery.maxRetries).toBe(3);
      expect(result.delivery.timeoutSeconds).toBe(30);
    });

    it('accepts all subscription statuses', () => {
      const statuses = ['active', 'paused', 'disabled', 'pending_verification'] as const;
      for (const status of statuses) {
        const sub = { ...validSubscription, status };
        const result = AutomationSubscriptionSchema.parse(sub);
        expect(result.status).toBe(status);
      }
    });

    it('accepts PUT http method', () => {
      const sub = { ...validSubscription, httpMethod: 'PUT' as const };
      const result = AutomationSubscriptionSchema.parse(sub);
      expect(result.httpMethod).toBe('PUT');
    });

    it('throws on invalid targetUrl', () => {
      const invalid = { ...validSubscription, targetUrl: 'not-a-url' };
      expect(() => AutomationSubscriptionSchema.parse(invalid)).toThrow();
    });

    it('throws on empty eventTypes', () => {
      const invalid = { ...validSubscription, eventTypes: [] };
      expect(() => AutomationSubscriptionSchema.parse(invalid)).toThrow();
    });

    it('validates delivery configuration bounds', () => {
      const invalidRetries = {
        ...validSubscription,
        delivery: { ...validSubscription.delivery, maxRetries: 15 }
      };
      expect(() => AutomationSubscriptionSchema.parse(invalidRetries)).toThrow();

      const invalidTimeout = {
        ...validSubscription,
        delivery: { ...validSubscription.delivery, timeoutSeconds: 120 }
      };
      expect(() => AutomationSubscriptionSchema.parse(invalidTimeout)).toThrow();
    });
  });

  describe('CreateSubscriptionRequestSchema', () => {
    it('parses valid create request', () => {
      const request = {
        name: 'New Integration',
        eventTypes: ['message.received'] as const,
        targetUrl: 'https://example.com/hook',
        secret: 'my-secret'
      };
      const result = CreateSubscriptionRequestSchema.parse(request);
      expect(result.eventTypes).toContain('message.received');
      expect(result.secret).toBe('my-secret');
    });

    it('applies default delivery config', () => {
      const request = {
        eventTypes: ['lead.captured'] as const,
        targetUrl: 'https://example.com/hook'
      };
      const result = CreateSubscriptionRequestSchema.parse(request);
      expect(result.delivery?.maxRetries).toBe(3);
    });
  });

  describe('CreateSubscriptionResponseSchema', () => {
    it('parses successful response', () => {
      const response = {
        success: true,
        subscription: validSubscription,
        verificationRequired: false
      };
      const result = CreateSubscriptionResponseSchema.parse(response);
      expect(result.success).toBe(true);
      expect(result.subscription?.id).toBe('sub-123');
    });

    it('parses error response', () => {
      const response = {
        success: false,
        error: 'Invalid URL'
      };
      const result = CreateSubscriptionResponseSchema.parse(response);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid URL');
    });

    it('indicates verification required', () => {
      const response = {
        success: true,
        subscription: validSubscription,
        verificationRequired: true
      };
      const result = CreateSubscriptionResponseSchema.parse(response);
      expect(result.verificationRequired).toBe(true);
    });
  });

  describe('UpdateSubscriptionRequestSchema', () => {
    it('parses partial update request', () => {
      const request = {
        id: 'sub-123',
        status: 'paused' as const
      };
      const result = UpdateSubscriptionRequestSchema.parse(request);
      expect(result.id).toBe('sub-123');
      expect(result.status).toBe('paused');
    });

    it('parses full update request', () => {
      const request = {
        id: 'sub-123',
        name: 'Updated Name',
        eventTypes: ['lead.captured'] as const,
        targetUrl: 'https://new-url.com/hook',
        status: 'active' as const
      };
      const result = UpdateSubscriptionRequestSchema.parse(request);
      expect(result.name).toBe('Updated Name');
      expect(result.targetUrl).toBe('https://new-url.com/hook');
    });
  });

  describe('UpdateSubscriptionResponseSchema', () => {
    it('parses successful update', () => {
      const response = {
        success: true,
        subscription: validSubscription
      };
      const result = UpdateSubscriptionResponseSchema.parse(response);
      expect(result.success).toBe(true);
    });
  });

  describe('DeleteSubscriptionRequestSchema', () => {
    it('parses delete request', () => {
      const request = { id: 'sub-123' };
      const result = DeleteSubscriptionRequestSchema.parse(request);
      expect(result.id).toBe('sub-123');
    });
  });

  describe('DeleteSubscriptionResponseSchema', () => {
    it('parses successful delete', () => {
      const response = { success: true };
      const result = DeleteSubscriptionResponseSchema.parse(response);
      expect(result.success).toBe(true);
    });

    it('parses failed delete', () => {
      const response = { success: false, error: 'Not found' };
      const result = DeleteSubscriptionResponseSchema.parse(response);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Not found');
    });
  });

  describe('DeliveryAttemptSchema', () => {
    it('parses successful delivery', () => {
      const attempt = {
        id: 'del-123',
        subscriptionId: 'sub-123',
        eventId: 'evt-123',
        status: 'delivered' as const,
        httpStatus: 200,
        attemptNumber: 1,
        attemptedAt: '2026-01-17T12:00:00Z',
        durationMs: 150
      };
      const result = DeliveryAttemptSchema.parse(attempt);
      expect(result.status).toBe('delivered');
      expect(result.httpStatus).toBe(200);
    });

    it('parses failed delivery', () => {
      const attempt = {
        id: 'del-456',
        subscriptionId: 'sub-123',
        eventId: 'evt-123',
        status: 'failed' as const,
        httpStatus: 500,
        error: 'Internal server error',
        attemptNumber: 3,
        attemptedAt: '2026-01-17T12:05:00Z'
      };
      const result = DeliveryAttemptSchema.parse(attempt);
      expect(result.status).toBe('failed');
      expect(result.error).toBe('Internal server error');
    });

    it('accepts all delivery statuses', () => {
      const statuses = ['pending', 'delivered', 'failed', 'retrying'] as const;
      for (const status of statuses) {
        const attempt = {
          id: 'del-xyz',
          subscriptionId: 'sub-123',
          eventId: 'evt-123',
          status,
          attemptNumber: 1,
          attemptedAt: '2026-01-17T12:00:00Z'
        };
        const result = DeliveryAttemptSchema.parse(attempt);
        expect(result.status).toBe(status);
      }
    });
  });

  describe('helper functions', () => {
    describe('parseAutomationTriggerEvent', () => {
      it('parses valid event', () => {
        const result = parseAutomationTriggerEvent(validTriggerEvent);
        expect(result.id).toBe('evt-123');
      });

      it('throws on invalid event', () => {
        expect(() => parseAutomationTriggerEvent({ invalid: true })).toThrow();
      });
    });

    describe('parseAutomationSubscription', () => {
      it('parses valid subscription', () => {
        const result = parseAutomationSubscription(validSubscription);
        expect(result.id).toBe('sub-123');
      });

      it('throws on invalid subscription', () => {
        expect(() => parseAutomationSubscription({ invalid: true })).toThrow();
      });
    });

    describe('buildAutomationEventDedupeKey', () => {
      it('builds correct dedupe key', () => {
        const key = buildAutomationEventDedupeKey('WHATSAPP', 'evt-123');
        expect(key).toBe('automation:whatsapp:evt-123');
      });
    });

    describe('createAutomationTriggerEvent', () => {
      it('creates event with defaults', () => {
        const event = createAutomationTriggerEvent({
          id: 'evt-new',
          type: 'lead.captured',
          source: 'facebook',
          payload: { leadId: 'lead-001' }
        });
        expect(event.id).toBe('evt-new');
        expect(event.type).toBe('lead.captured');
        expect(event.metadata.priority).toBe('normal');
        expect(event.occurredAt).toBeDefined();
      });

      it('allows overriding defaults', () => {
        const event = createAutomationTriggerEvent({
          id: 'evt-new',
          type: 'message.received',
          source: 'whatsapp',
          payload: {},
          metadata: {
            schemaVersion: '2.0',
            priority: 'high',
            tags: ['test'],
            extra: {}
          }
        });
        expect(event.metadata.schemaVersion).toBe('2.0');
        expect(event.metadata.priority).toBe('high');
      });
    });

    describe('isSubscriptionActive', () => {
      it('returns true for active subscription', () => {
        expect(isSubscriptionActive(validSubscription)).toBe(true);
      });

      it('returns false for paused subscription', () => {
        const paused = { ...validSubscription, status: 'paused' as const };
        expect(isSubscriptionActive(paused)).toBe(false);
      });

      it('returns false for disabled subscription', () => {
        const disabled = { ...validSubscription, status: 'disabled' as const };
        expect(isSubscriptionActive(disabled)).toBe(false);
      });
    });

    describe('subscriptionMatchesEvent', () => {
      it('returns true when event type matches', () => {
        const subscription = { ...validSubscription, filters: undefined };
        expect(subscriptionMatchesEvent(subscription, validTriggerEvent)).toBe(true);
      });

      it('returns false when event type does not match', () => {
        const event = { ...validTriggerEvent, type: 'contact.created' as const };
        expect(subscriptionMatchesEvent(validSubscription, event)).toBe(false);
      });

      it('returns true when source filter matches', () => {
        expect(subscriptionMatchesEvent(validSubscription, validTriggerEvent)).toBe(true);
      });

      it('returns false when source filter does not match', () => {
        const event = { ...validTriggerEvent, source: 'telegram' };
        expect(subscriptionMatchesEvent(validSubscription, event)).toBe(false);
      });

      it('returns true when tag filter matches', () => {
        expect(subscriptionMatchesEvent(validSubscription, validTriggerEvent)).toBe(true);
      });

      it('returns false when tag filter does not match', () => {
        const event = {
          ...validTriggerEvent,
          metadata: { ...validTriggerEvent.metadata, tags: ['regular'] }
        };
        expect(subscriptionMatchesEvent(validSubscription, event)).toBe(false);
      });

      it('matches when no filters are defined', () => {
        const subscription = {
          ...validSubscription,
          filters: undefined
        };
        expect(subscriptionMatchesEvent(subscription, validTriggerEvent)).toBe(true);
      });
    });
  });
});

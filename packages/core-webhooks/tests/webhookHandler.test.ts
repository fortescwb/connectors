import { describe, expect, it, vi } from 'vitest';

import {
  makeConversationMessageReceived,
  type ConversationMessageReceivedEvent
} from '@connectors/core-events';
import type { TenantId } from '@connectors/core-tenant';
import { ValidationError } from '@connectors/core-validation';

import { createWebhookProcessor, NoopDedupeStore } from '../src/index.js';

const tenantId = 'tenant-test' as TenantId;

describe('createWebhookProcessor', () => {
  it('returns 400 on parse error with standardized body and correlationId', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const onEvent = vi.fn();
    const processor = createWebhookProcessor({
      serviceName: 'test-service',
      parseEvent: () => {
        throw new ValidationError('invalid payload', []);
      },
      onEvent
    });

    const res = await processor({ headers: {}, body: {} });
    expect(res.status).toBe(400);

    const body = res.body as { ok: boolean; code: string; message: string; correlationId: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe('WEBHOOK_VALIDATION_FAILED');
    expect(body.message).toBe('invalid payload');
    expect(typeof body.correlationId).toBe('string');
    expect(body.correlationId.length).toBeGreaterThan(0);

    // Verify correlationId header
    expect(res.headers?.['x-correlation-id']).toBe(body.correlationId);

    expect(onEvent).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('dedupes repeated payloads with deduped indicator and correlationId in response', async () => {
    const envelope: ConversationMessageReceivedEvent = makeConversationMessageReceived({
      tenantId,
      source: 'test-suite',
      payload: {
        channel: 'whatsapp',
        externalMessageId: 'msg-1',
        conversationId: 'conv-1',
        direction: 'inbound',
        sender: { id: 'contact-1' },
        recipient: { id: 'agent-1' },
        content: { type: 'text', text: 'hello' }
      }
    });

    const onEvent = vi.fn().mockResolvedValue(undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const processor = createWebhookProcessor({
      serviceName: 'test-service',
      parseEvent: () => envelope,
      onEvent
    });

    const first = await processor({ headers: {}, body: envelope });
    const second = await processor({ headers: {}, body: envelope });

    // Validate response structure
    expect(first.status).toBe(200);
    const firstBody = first.body as { ok: boolean; deduped: boolean; correlationId: string };
    expect(firstBody.ok).toBe(true);
    expect(firstBody.deduped).toBe(false);
    expect(typeof firstBody.correlationId).toBe('string');
    expect(first.headers?.['x-correlation-id']).toBe(firstBody.correlationId);

    expect(second.status).toBe(200);
    const secondBody = second.body as { ok: boolean; deduped: boolean; correlationId: string };
    expect(secondBody.ok).toBe(true);
    expect(secondBody.deduped).toBe(true);
    expect(typeof secondBody.correlationId).toBe('string');
    expect(second.headers?.['x-correlation-id']).toBe(secondBody.correlationId);

    // onEvent should only be called once (first request)
    expect(onEvent).toHaveBeenCalledTimes(1);

    // Validate logs
    const loggedEntries = logSpy.mock.calls
      .map((call) => call[0])
      .map((entry) => {
        try {
          return JSON.parse(entry as string);
        } catch {
          return {};
        }
      });

    const dedupeLog = loggedEntries.find((entry) => entry.deduped === true);
    expect(dedupeLog?.deduped).toBe(true);
    expect(dedupeLog?.dedupeKey).toBe(envelope.dedupeKey);

    logSpy.mockRestore();
  });

  it('processes all events with NoopDedupeStore', async () => {
    const envelope: ConversationMessageReceivedEvent = makeConversationMessageReceived({
      tenantId,
      source: 'test-suite',
      payload: {
        channel: 'whatsapp',
        externalMessageId: 'msg-noop-1',
        conversationId: 'conv-noop-1',
        direction: 'inbound',
        sender: { id: 'contact-1' },
        recipient: { id: 'agent-1' },
        content: { type: 'text', text: 'hello noop' }
      }
    });

    const onEvent = vi.fn().mockResolvedValue(undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const processor = createWebhookProcessor({
      serviceName: 'test-service',
      parseEvent: () => envelope,
      onEvent,
      dedupeStore: new NoopDedupeStore()
    });

    const first = await processor({ headers: {}, body: envelope });
    const second = await processor({ headers: {}, body: envelope });

    // Both should process without deduplication
    expect(first.status).toBe(200);
    expect((first.body as { deduped: boolean }).deduped).toBe(false);

    expect(second.status).toBe(200);
    expect((second.body as { deduped: boolean }).deduped).toBe(false);

    // onEvent should be called twice
    expect(onEvent).toHaveBeenCalledTimes(2);

    logSpy.mockRestore();
  });

  it('preserves x-correlation-id from request headers in response', async () => {
    const envelope: ConversationMessageReceivedEvent = makeConversationMessageReceived({
      tenantId,
      source: 'test-suite',
      payload: {
        channel: 'whatsapp',
        externalMessageId: 'msg-cid-header-1',
        conversationId: 'conv-cid-header-1',
        direction: 'inbound',
        sender: { id: 'contact-1' },
        recipient: { id: 'agent-1' },
        content: { type: 'text', text: 'hello with correlationId' }
      }
    });

    const onEvent = vi.fn().mockResolvedValue(undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const processor = createWebhookProcessor({
      serviceName: 'test-service',
      parseEvent: () => envelope,
      onEvent,
      dedupeStore: new NoopDedupeStore()
    });

    const customCorrelationId = 'custom-cid-12345';
    const res = await processor({
      headers: { 'x-correlation-id': customCorrelationId },
      body: envelope
    });

    expect(res.status).toBe(200);
    const body = res.body as { ok: boolean; deduped: boolean; correlationId: string };
    expect(body.correlationId).toBe(customCorrelationId);
    expect(res.headers?.['x-correlation-id']).toBe(customCorrelationId);

    logSpy.mockRestore();
  });

  it('preserves x-correlation-id in error responses', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const onEvent = vi.fn();
    const processor = createWebhookProcessor({
      serviceName: 'test-service',
      parseEvent: () => {
        throw new ValidationError('invalid payload', []);
      },
      onEvent
    });

    const customCorrelationId = 'error-cid-67890';
    const res = await processor({
      headers: { 'x-correlation-id': customCorrelationId },
      body: {}
    });

    expect(res.status).toBe(400);
    const body = res.body as { ok: boolean; code: string; correlationId: string };
    expect(body.correlationId).toBe(customCorrelationId);
    expect(res.headers?.['x-correlation-id']).toBe(customCorrelationId);

    logSpy.mockRestore();
  });

  it('handles x-correlation-id as array (uses first element)', async () => {
    const envelope: ConversationMessageReceivedEvent = makeConversationMessageReceived({
      tenantId,
      source: 'test-suite',
      payload: {
        channel: 'whatsapp',
        externalMessageId: 'msg-cid-array-1',
        conversationId: 'conv-cid-array-1',
        direction: 'inbound',
        sender: { id: 'contact-1' },
        recipient: { id: 'agent-1' },
        content: { type: 'text', text: 'hello with array correlationId' }
      }
    });

    const onEvent = vi.fn().mockResolvedValue(undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const processor = createWebhookProcessor({
      serviceName: 'test-service',
      parseEvent: () => envelope,
      onEvent,
      dedupeStore: new NoopDedupeStore()
    });

    const res = await processor({
      headers: { 'x-correlation-id': ['first-cid', 'second-cid'] },
      body: envelope
    });

    expect(res.status).toBe(200);
    const body = res.body as { ok: boolean; correlationId: string };
    expect(body.correlationId).toBe('first-cid');
    expect(res.headers?.['x-correlation-id']).toBe('first-cid');

    logSpy.mockRestore();
  });
});

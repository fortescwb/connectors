import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { makeConversationMessageReceived } from '@connectors/core-events';
import type { TenantId } from '@connectors/core-tenant';

import { buildApp } from '../src/app.js';

describe('whatsapp app', () => {
  const tenantId = 'tenant-test' as TenantId;

  it('responds 200 on /health', async () => {
    const app = buildApp();
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('rejects invalid webhook payload with 400, standardized error, and correlationId', async () => {
    const app = buildApp();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const response = await request(app).post('/webhook').send({});
    expect(response.status).toBe(400);
    expect(response.body.ok).toBe(false);
    expect(response.body.code).toBe('WEBHOOK_VALIDATION_FAILED');
    expect(typeof response.body.message).toBe('string');
    expect(typeof response.body.correlationId).toBe('string');
    expect(response.headers['x-correlation-id']).toBe(response.body.correlationId);
    logSpy.mockRestore();
  });

  it('accepts valid webhook payload with deduped:false and correlationId', async () => {
    const app = buildApp();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const envelope = makeConversationMessageReceived({
      tenantId,
      source: 'test-suite',
      payload: {
        channel: 'whatsapp',
        externalMessageId: 'msg-valid-2',
        conversationId: 'conv-2',
        direction: 'inbound',
        sender: { id: 'contact-1' },
        recipient: { id: 'agent-1' },
        content: { type: 'text', text: 'Hello' }
      }
    });

    const response = await request(app).post('/webhook').send(envelope);

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.deduped).toBe(false);
    expect(typeof response.body.correlationId).toBe('string');
    expect(response.headers['x-correlation-id']).toBe(response.body.correlationId);

    const receivedLogs = logSpy.mock.calls
      .map((call) => call[0])
      .map((value) => {
        try {
          return JSON.parse(value as string);
        } catch {
          return {};
        }
      })
      .filter((entry) => entry.message === 'Received webhook event');

    expect(receivedLogs.length).toBe(1);
    logSpy.mockRestore();
  });

  it('dedupes repeated payloads with deduped indicator and correlationId in response', async () => {
    const app = buildApp();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    // Use unique externalMessageId to avoid collision with other tests
    const envelope = makeConversationMessageReceived({
      tenantId,
      source: 'test-suite',
      payload: {
        channel: 'whatsapp',
        externalMessageId: 'msg-dedupe-test-2',
        conversationId: 'conv-dedupe-2',
        direction: 'inbound',
        sender: { id: 'contact-1' },
        recipient: { id: 'agent-1' },
        content: { type: 'text', text: 'Hello Dedupe' }
      }
    });

    const first = await request(app).post('/webhook').send(envelope);
    const second = await request(app).post('/webhook').send(envelope);

    // Validate response bodies explicitly
    expect(first.status).toBe(200);
    expect(first.body.ok).toBe(true);
    expect(first.body.deduped).toBe(false);
    expect(typeof first.body.correlationId).toBe('string');
    expect(first.headers['x-correlation-id']).toBe(first.body.correlationId);

    expect(second.status).toBe(200);
    expect(second.body.ok).toBe(true);
    expect(second.body.deduped).toBe(true);
    expect(typeof second.body.correlationId).toBe('string');
    expect(second.headers['x-correlation-id']).toBe(second.body.correlationId);

    // Validate logs
    const parsedLogs = logSpy.mock.calls
      .map((call) => call[0])
      .map((value) => {
        try {
          return JSON.parse(value as string);
        } catch {
          return {};
        }
      });

    const receivedLogs = parsedLogs.filter((entry) => entry.message === 'Received webhook event');
    expect(receivedLogs.length).toBe(1);

    const dedupeLog = parsedLogs.find((entry) => entry.message === 'Duplicate webhook event skipped');
    expect(dedupeLog?.deduped).toBe(true);
    expect(dedupeLog?.dedupeKey).toBe(envelope.dedupeKey);

    logSpy.mockRestore();
  });
});

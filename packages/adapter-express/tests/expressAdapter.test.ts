import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { makeConversationMessageReceived } from '@connectors/core-events';
import type { TenantId } from '@connectors/core-tenant';
import { ValidationError } from '@connectors/core-validation';

import { createExpressWebhookHandlerFromOptions, rawBodyMiddleware } from '../src/index.js';

const tenantId = 'tenant-test' as TenantId;

describe('adapter-express', () => {
  it('passes through processor result with ok, deduped, correlationId and header', async () => {
    const envelope = makeConversationMessageReceived({
      tenantId,
      source: 'test-suite',
      payload: {
        channel: 'whatsapp',
        externalMessageId: 'msg-1',
        conversationId: 'conv-1',
        direction: 'inbound',
        sender: { id: 'contact-1' },
        recipient: { id: 'agent-1' },
        content: { type: 'text', text: 'hi' }
      }
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const app = express();
    app.use(express.json());
    app.post(
      '/webhook',
      createExpressWebhookHandlerFromOptions({
        serviceName: 'test-service',
        parseEvent: () => envelope,
        onEvent: async () => {}
      })
    );

    const res = await request(app).post('/webhook').send(envelope);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.deduped).toBe(false);
    expect(typeof res.body.correlationId).toBe('string');
    expect(res.headers['x-correlation-id']).toBe(res.body.correlationId);

    logSpy.mockRestore();
  });

  it('passes through error response with standardized format and correlationId', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const app = express();
    app.use(express.json());
    app.post(
      '/webhook',
      createExpressWebhookHandlerFromOptions({
        serviceName: 'test-service',
        parseEvent: () => {
          throw new ValidationError('bad request', []);
        },
        onEvent: async () => {}
      })
    );

    const res = await request(app).post('/webhook').send({});

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('WEBHOOK_VALIDATION_FAILED');
    expect(res.body.message).toBe('bad request');
    expect(typeof res.body.correlationId).toBe('string');
    expect(res.headers['x-correlation-id']).toBe(res.body.correlationId);

    logSpy.mockRestore();
  });

  it('captures rawBody with rawBodyMiddleware', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    let capturedRawBody: Buffer | undefined;

    const app = express();
    app.post(
      '/webhook',
      rawBodyMiddleware(),
      createExpressWebhookHandlerFromOptions({
        serviceName: 'test-service',
        parseEvent: (input) => {
          capturedRawBody = input.rawBody as Buffer;
          // Return a valid envelope for processing
          return makeConversationMessageReceived({
            tenantId,
            source: 'test-suite',
            payload: {
              channel: 'whatsapp',
              externalMessageId: 'msg-raw-1',
              conversationId: 'conv-1',
              direction: 'inbound',
              sender: { id: 'contact-1' },
              recipient: { id: 'agent-1' },
              content: { type: 'text', text: 'hello' }
            }
          });
        },
        onEvent: async () => {}
      })
    );

    const payload = { test: 'data' };
    await request(app).post('/webhook').send(payload);

    expect(capturedRawBody).toBeInstanceOf(Buffer);
    expect(capturedRawBody?.toString('utf-8')).toBe(JSON.stringify(payload));

    logSpy.mockRestore();
  });
});

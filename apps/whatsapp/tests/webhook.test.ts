import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeConversationMessageReceived } from '@connectors/core-events';
import type { TenantId } from '@connectors/core-tenant';
import { generateHmacSha256 } from '@connectors/core-signature';

import { buildApp } from '../src/app.js';

describe('whatsapp app', () => {
  const tenantId = 'tenant-test' as TenantId;

  beforeEach(() => {
    // Clear env before each test
    delete process.env.WHATSAPP_WEBHOOK_SECRET;
    delete process.env.WHATSAPP_VERIFY_TOKEN;
  });

  afterEach(() => {
    delete process.env.WHATSAPP_WEBHOOK_SECRET;
    delete process.env.WHATSAPP_VERIFY_TOKEN;
  });

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

  describe('signature validation', () => {
    const TEST_SECRET = 'whatsapp-test-secret-key';

    it('skips signature validation when WHATSAPP_WEBHOOK_SECRET is not set', async () => {
      // Ensure no secret is set
      delete process.env.WHATSAPP_WEBHOOK_SECRET;

      const app = buildApp();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const envelope = makeConversationMessageReceived({
        tenantId,
        source: 'test-suite',
        payload: {
          channel: 'whatsapp',
          externalMessageId: 'msg-no-secret-1',
          conversationId: 'conv-no-secret-1',
          direction: 'inbound',
          sender: { id: 'contact-1' },
          recipient: { id: 'agent-1' },
          content: { type: 'text', text: 'Hello without secret' }
        }
      });

      const response = await request(app).post('/webhook').send(envelope);

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      expect(typeof response.body.correlationId).toBe('string');
      expect(response.headers['x-correlation-id']).toBe(response.body.correlationId);

      // Verify "signatureValidation: skipped" was logged
      const parsedLogs = logSpy.mock.calls
        .map((call) => call[0])
        .map((value) => {
          try {
            return JSON.parse(value as string);
          } catch {
            return {};
          }
        });

      const skipLog = parsedLogs.find(
        (entry) => entry.message === 'Signature validation skipped' && entry.signatureValidation === 'skipped'
      );
      expect(skipLog).toBeDefined();
      expect(typeof skipLog?.correlationId).toBe('string');

      logSpy.mockRestore();
    });

    it('accepts webhook with valid signature when secret is set', async () => {
      process.env.WHATSAPP_WEBHOOK_SECRET = TEST_SECRET;

      const app = buildApp();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const envelope = makeConversationMessageReceived({
        tenantId,
        source: 'test-suite',
        payload: {
          channel: 'whatsapp',
          externalMessageId: 'msg-valid-sig-1',
          conversationId: 'conv-valid-sig-1',
          direction: 'inbound',
          sender: { id: 'contact-1' },
          recipient: { id: 'agent-1' },
          content: { type: 'text', text: 'Hello with valid signature' }
        }
      });

      // Generate the raw body exactly as supertest will send it
      const rawBody = JSON.stringify(envelope);
      const signature = generateHmacSha256(TEST_SECRET, rawBody, 'sha256=');

      const response = await request(app)
        .post('/webhook')
        .set('Content-Type', 'application/json')
        .set('x-hub-signature-256', signature)
        .send(rawBody);

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      expect(response.body.deduped).toBe(false);
      expect(typeof response.body.correlationId).toBe('string');
      expect(response.headers['x-correlation-id']).toBe(response.body.correlationId);

      logSpy.mockRestore();
    });

    it('rejects webhook with invalid signature when secret is set', async () => {
      process.env.WHATSAPP_WEBHOOK_SECRET = TEST_SECRET;

      const app = buildApp();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const envelope = makeConversationMessageReceived({
        tenantId,
        source: 'test-suite',
        payload: {
          channel: 'whatsapp',
          externalMessageId: 'msg-invalid-sig-1',
          conversationId: 'conv-invalid-sig-1',
          direction: 'inbound',
          sender: { id: 'contact-1' },
          recipient: { id: 'agent-1' },
          content: { type: 'text', text: 'Hello with invalid signature' }
        }
      });

      const rawBody = JSON.stringify(envelope);
      // Use wrong secret to generate invalid signature
      const invalidSignature = generateHmacSha256('wrong-secret', rawBody, 'sha256=');

      const response = await request(app)
        .post('/webhook')
        .set('Content-Type', 'application/json')
        .set('x-hub-signature-256', invalidSignature)
        .send(rawBody);

      expect(response.status).toBe(401);
      expect(response.body.ok).toBe(false);
      expect(response.body.code).toBe('UNAUTHORIZED');
      expect(response.body.message).toBe('Invalid signature');
      expect(typeof response.body.correlationId).toBe('string');
      expect(response.headers['x-correlation-id']).toBe(response.body.correlationId);

      logSpy.mockRestore();
    });

    it('rejects webhook with missing signature header when secret is set', async () => {
      process.env.WHATSAPP_WEBHOOK_SECRET = TEST_SECRET;

      const app = buildApp();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const envelope = makeConversationMessageReceived({
        tenantId,
        source: 'test-suite',
        payload: {
          channel: 'whatsapp',
          externalMessageId: 'msg-missing-sig-1',
          conversationId: 'conv-missing-sig-1',
          direction: 'inbound',
          sender: { id: 'contact-1' },
          recipient: { id: 'agent-1' },
          content: { type: 'text', text: 'Hello without signature header' }
        }
      });

      // Send without x-hub-signature-256 header
      const response = await request(app).post('/webhook').send(envelope);

      expect(response.status).toBe(401);
      expect(response.body.ok).toBe(false);
      expect(response.body.code).toBe('UNAUTHORIZED');
      expect(response.body.message).toBe('Invalid signature');
      expect(typeof response.body.correlationId).toBe('string');
      expect(response.headers['x-correlation-id']).toBe(response.body.correlationId);

      logSpy.mockRestore();
    });
  });

  describe('webhook verification (GET /webhook)', () => {
    const TEST_VERIFY_TOKEN = 'my-verify-token-123';

    it('returns 200 with challenge when verification is valid', async () => {
      process.env.WHATSAPP_VERIFY_TOKEN = TEST_VERIFY_TOKEN;

      const app = buildApp();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const challenge = 'test-challenge-string-12345';

      const response = await request(app)
        .get('/webhook')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': TEST_VERIFY_TOKEN,
          'hub.challenge': challenge
        });

      expect(response.status).toBe(200);
      expect(response.text).toBe(challenge);
      expect(response.type).toBe('text/plain');
      expect(typeof response.headers['x-correlation-id']).toBe('string');

      logSpy.mockRestore();
    });

    it('returns 403 when verify token is invalid', async () => {
      process.env.WHATSAPP_VERIFY_TOKEN = TEST_VERIFY_TOKEN;

      const app = buildApp();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const challenge = 'test-challenge-string';

      const response = await request(app)
        .get('/webhook')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'wrong-token',
          'hub.challenge': challenge
        });

      expect(response.status).toBe(403);
      expect(response.body.ok).toBe(false);
      expect(response.body.code).toBe('FORBIDDEN');
      expect(response.body.message).toBe('Invalid verify token');
      expect(typeof response.body.correlationId).toBe('string');
      expect(response.headers['x-correlation-id']).toBe(response.body.correlationId);

      logSpy.mockRestore();
    });

    it('returns 403 when hub.mode is not subscribe', async () => {
      process.env.WHATSAPP_VERIFY_TOKEN = TEST_VERIFY_TOKEN;

      const app = buildApp();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const response = await request(app)
        .get('/webhook')
        .query({
          'hub.mode': 'unsubscribe',
          'hub.verify_token': TEST_VERIFY_TOKEN,
          'hub.challenge': 'test-challenge'
        });

      expect(response.status).toBe(403);
      expect(response.body.ok).toBe(false);
      expect(response.body.code).toBe('FORBIDDEN');
      expect(response.body.message).toBe('Invalid hub.mode');
      expect(typeof response.body.correlationId).toBe('string');
      expect(response.headers['x-correlation-id']).toBe(response.body.correlationId);

      logSpy.mockRestore();
    });

    it('returns 503 when WHATSAPP_VERIFY_TOKEN is not configured', async () => {
      // Ensure env is not set
      delete process.env.WHATSAPP_VERIFY_TOKEN;

      const app = buildApp();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const response = await request(app)
        .get('/webhook')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'any-token',
          'hub.challenge': 'test-challenge'
        });

      expect(response.status).toBe(503);
      expect(response.body.ok).toBe(false);
      expect(response.body.code).toBe('SERVICE_UNAVAILABLE');
      expect(response.body.message).toBe('Webhook verification not configured');
      expect(typeof response.body.correlationId).toBe('string');
      expect(response.headers['x-correlation-id']).toBe(response.body.correlationId);

      logSpy.mockRestore();
    });
  });

  describe('correlationId propagation', () => {
    it('preserves incoming x-correlation-id header in response', async () => {
      const app = buildApp();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const customCorrelationId = 'cid-test-123';
      const envelope = makeConversationMessageReceived({
        tenantId,
        source: 'test-suite',
        payload: {
          channel: 'whatsapp',
          externalMessageId: 'msg-cid-prop-1',
          conversationId: 'conv-cid-prop-1',
          direction: 'inbound',
          sender: { id: 'contact-1' },
          recipient: { id: 'agent-1' },
          content: { type: 'text', text: 'Hello with correlationId' }
        }
      });

      const response = await request(app)
        .post('/webhook')
        .set('x-correlation-id', customCorrelationId)
        .send(envelope);

      expect(response.status).toBe(200);
      expect(response.headers['x-correlation-id']).toBe(customCorrelationId);
      expect(response.body.correlationId).toBe(customCorrelationId);

      logSpy.mockRestore();
    });

    it('generates correlationId when not provided in request', async () => {
      const app = buildApp();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const envelope = makeConversationMessageReceived({
        tenantId,
        source: 'test-suite',
        payload: {
          channel: 'whatsapp',
          externalMessageId: 'msg-cid-gen-1',
          conversationId: 'conv-cid-gen-1',
          direction: 'inbound',
          sender: { id: 'contact-1' },
          recipient: { id: 'agent-1' },
          content: { type: 'text', text: 'Hello without correlationId' }
        }
      });

      const response = await request(app)
        .post('/webhook')
        .send(envelope);

      expect(response.status).toBe(200);
      expect(typeof response.headers['x-correlation-id']).toBe('string');
      expect(response.headers['x-correlation-id'].length).toBeGreaterThan(0);
      expect(response.body.correlationId).toBe(response.headers['x-correlation-id']);

      logSpy.mockRestore();
    });

    it('preserves correlationId in 401 error response', async () => {
      process.env.WHATSAPP_WEBHOOK_SECRET = 'test-secret';

      const app = buildApp();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const customCorrelationId = 'cid-error-test-456';
      const envelope = makeConversationMessageReceived({
        tenantId,
        source: 'test-suite',
        payload: {
          channel: 'whatsapp',
          externalMessageId: 'msg-cid-error-1',
          conversationId: 'conv-cid-error-1',
          direction: 'inbound',
          sender: { id: 'contact-1' },
          recipient: { id: 'agent-1' },
          content: { type: 'text', text: 'Hello with error' }
        }
      });

      // Send with wrong signature but custom correlationId
      const response = await request(app)
        .post('/webhook')
        .set('x-correlation-id', customCorrelationId)
        .set('x-hub-signature-256', 'sha256=invalid')
        .send(envelope);

      expect(response.status).toBe(401);
      expect(response.headers['x-correlation-id']).toBe(customCorrelationId);
      expect(response.body.correlationId).toBe(customCorrelationId);

      logSpy.mockRestore();
    });
  });
});

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeConversationMessageReceived } from '@connectors/core-events';
import type { TenantId } from '@connectors/core-tenant';
import { generateHmacSha256 } from '@connectors/core-signature';

import { buildApp } from '../src/app.js';
import { instagramManifest } from '../src/manifest.js';

describe('instagram app', () => {
  const tenantId = 'tenant-test' as TenantId;

  beforeEach(() => {
    delete process.env.INSTAGRAM_WEBHOOK_SECRET;
    delete process.env.INSTAGRAM_VERIFY_TOKEN;
  });

  afterEach(() => {
    delete process.env.INSTAGRAM_WEBHOOK_SECRET;
    delete process.env.INSTAGRAM_VERIFY_TOKEN;
  });

  describe('manifest', () => {
    it('has required fields', () => {
      expect(instagramManifest.id).toBe('instagram');
      expect(instagramManifest.platform).toBe('meta');
      expect(instagramManifest.capabilities.length).toBeGreaterThan(0);
    });

    it('declares expected capabilities', () => {
      const capabilityIds = instagramManifest.capabilities.map((c) => c.id);
      expect(capabilityIds).toContain('comment_ingest');
      expect(capabilityIds).toContain('comment_reply');
      expect(capabilityIds).toContain('ads_leads_ingest');
      expect(capabilityIds).toContain('inbound_messages');
    });
  });

  describe('health check', () => {
    it('responds 200 on /health with connector info', async () => {
      const app = buildApp();
      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ok', connector: 'instagram' });
    });
  });

  describe('webhook POST', () => {
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

    it('accepts valid webhook payload with fullyDeduped:false and correlationId', async () => {
      const app = buildApp();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const envelope = makeConversationMessageReceived({
        tenantId,
        source: 'instagram-webhook',
        payload: {
          channel: 'instagram',
          externalMessageId: 'ig-msg-1',
          conversationId: 'ig-conv-1',
          direction: 'inbound',
          sender: { id: 'ig-user-1' },
          recipient: { id: 'ig-page-1' },
          content: { type: 'text', text: 'Hello from Instagram' }
        }
      });

      const response = await request(app).post('/webhook').send(envelope);

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      expect(response.body.fullyDeduped).toBe(false);
      expect(typeof response.body.correlationId).toBe('string');
      expect(response.headers['x-correlation-id']).toBe(response.body.correlationId);

      logSpy.mockRestore();
    });

    it('preserves x-correlation-id from request', async () => {
      const app = buildApp();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const customCorrelationId = 'ig-cid-123';
      const envelope = makeConversationMessageReceived({
        tenantId,
        source: 'instagram-webhook',
        payload: {
          channel: 'instagram',
          externalMessageId: 'ig-msg-cid-1',
          conversationId: 'ig-conv-cid-1',
          direction: 'inbound',
          sender: { id: 'ig-user-1' },
          recipient: { id: 'ig-page-1' },
          content: { type: 'text', text: 'Hello' }
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
  });

  describe('signature validation', () => {
    const TEST_SECRET = 'instagram-test-secret';

    it('skips validation when INSTAGRAM_WEBHOOK_SECRET is not set', async () => {
      delete process.env.INSTAGRAM_WEBHOOK_SECRET;
      const app = buildApp();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const envelope = makeConversationMessageReceived({
        tenantId,
        source: 'instagram-webhook',
        payload: {
          channel: 'instagram',
          externalMessageId: 'ig-msg-nosecret-1',
          conversationId: 'ig-conv-1',
          direction: 'inbound',
          sender: { id: 'ig-user-1' },
          recipient: { id: 'ig-page-1' },
          content: { type: 'text', text: 'No secret' }
        }
      });

      const response = await request(app).post('/webhook').send(envelope);
      expect(response.status).toBe(200);

      logSpy.mockRestore();
    });

    it('accepts valid signature when secret is set', async () => {
      process.env.INSTAGRAM_WEBHOOK_SECRET = TEST_SECRET;
      const app = buildApp();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const envelope = makeConversationMessageReceived({
        tenantId,
        source: 'instagram-webhook',
        payload: {
          channel: 'instagram',
          externalMessageId: 'ig-msg-sig-1',
          conversationId: 'ig-conv-1',
          direction: 'inbound',
          sender: { id: 'ig-user-1' },
          recipient: { id: 'ig-page-1' },
          content: { type: 'text', text: 'With signature' }
        }
      });

      const rawBody = JSON.stringify(envelope);
      const signature = generateHmacSha256(TEST_SECRET, rawBody, 'sha256=');

      const response = await request(app)
        .post('/webhook')
        .set('Content-Type', 'application/json')
        .set('x-hub-signature-256', signature)
        .send(rawBody);

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);

      logSpy.mockRestore();
    });

    it('rejects invalid signature when secret is set', async () => {
      process.env.INSTAGRAM_WEBHOOK_SECRET = TEST_SECRET;
      const app = buildApp();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const envelope = makeConversationMessageReceived({
        tenantId,
        source: 'instagram-webhook',
        payload: {
          channel: 'instagram',
          externalMessageId: 'ig-msg-badsig-1',
          conversationId: 'ig-conv-1',
          direction: 'inbound',
          sender: { id: 'ig-user-1' },
          recipient: { id: 'ig-page-1' },
          content: { type: 'text', text: 'Bad signature' }
        }
      });

      const rawBody = JSON.stringify(envelope);
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

      logSpy.mockRestore();
    });
  });

  describe('webhook verification (GET /webhook)', () => {
    const TEST_VERIFY_TOKEN = 'ig-verify-token-123';

    it('returns 200 with challenge when verification is valid', async () => {
      process.env.INSTAGRAM_VERIFY_TOKEN = TEST_VERIFY_TOKEN;
      const app = buildApp();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const challenge = 'ig-challenge-string-12345';

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
      process.env.INSTAGRAM_VERIFY_TOKEN = TEST_VERIFY_TOKEN;
      const app = buildApp();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const response = await request(app)
        .get('/webhook')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'wrong-token',
          'hub.challenge': 'challenge'
        });

      expect(response.status).toBe(403);
      expect(response.body.ok).toBe(false);
      expect(response.body.code).toBe('FORBIDDEN');
      expect(response.body.message).toBe('Invalid verify token');
      expect(response.headers['x-correlation-id']).toBe(response.body.correlationId);

      logSpy.mockRestore();
    });

    it('returns 403 when hub.mode is not subscribe', async () => {
      process.env.INSTAGRAM_VERIFY_TOKEN = TEST_VERIFY_TOKEN;
      const app = buildApp();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const response = await request(app)
        .get('/webhook')
        .query({
          'hub.mode': 'unsubscribe',
          'hub.verify_token': TEST_VERIFY_TOKEN,
          'hub.challenge': 'challenge'
        });

      expect(response.status).toBe(403);
      expect(response.body.ok).toBe(false);
      expect(response.body.code).toBe('FORBIDDEN');
      expect(response.body.message).toBe('Invalid hub.mode');

      logSpy.mockRestore();
    });

    it('returns 503 when INSTAGRAM_VERIFY_TOKEN is not configured', async () => {
      delete process.env.INSTAGRAM_VERIFY_TOKEN;
      const app = buildApp();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const response = await request(app)
        .get('/webhook')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'any-token',
          'hub.challenge': 'challenge'
        });

      expect(response.status).toBe(503);
      expect(response.body.ok).toBe(false);
      expect(response.body.code).toBe('SERVICE_UNAVAILABLE');
      expect(response.body.message).toBe('Webhook verification not configured');

      logSpy.mockRestore();
    });
  });
});

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateHmacSha256 } from '@connectors/core-signature';

import { buildApp } from '../src/app.js';
import { instagramManifest } from '../src/manifest.js';
import textMessage from '../../../packages/core-meta-instagram/fixtures/message_text.json';
import batchMixed from '../../../packages/core-meta-instagram/fixtures/batch_mixed.json';

describe('instagram app', () => {
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

    it('declares inbound_messages as active', () => {
      const inboundCapability = instagramManifest.capabilities.find((c) => c.id === 'inbound_messages');
      expect(inboundCapability).toBeDefined();
      expect(inboundCapability?.status).toBe('active');
    });

    it('has webhook_verification active', () => {
      const verifyCapability = instagramManifest.capabilities.find((c) => c.id === 'webhook_verification');
      expect(verifyCapability).toBeDefined();
      expect(verifyCapability?.status).toBe('active');
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

  describe('webhook POST with real fixtures', () => {
    it('accepts real Instagram DM text message (fixture) and processes 1 item', async () => {
      const app = buildApp();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const response = await request(app).post('/webhook').send(textMessage);

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      expect(response.body.fullyDeduped).toBe(false);
      expect(response.body.summary.total).toBe(1);
      expect(response.body.summary.processed).toBe(1);
      expect(response.body.summary.deduped).toBe(0);
      expect(response.body.summary.failed).toBe(0);
      expect(response.body.results).toHaveLength(1);
      expect(response.body.results[0].capabilityId).toBe('inbound_messages');
      expect(response.body.results[0].dedupeKey).toContain('instagram:17841400000000000:msg:m_igmsg_111');

      logSpy.mockRestore();
    });

    it('accepts batch DM fixture (2 messages) and processes both items', async () => {
      const app = buildApp();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const response = await request(app).post('/webhook').send(batchMixed);

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      expect(response.body.fullyDeduped).toBe(false);
      expect(response.body.summary.total).toBe(2);
      expect(response.body.summary.processed).toBe(2);
      expect(response.body.results).toHaveLength(2);
      expect(response.body.results[0].dedupeKey).toContain('instagram:17841400000000000:msg:m_igmsg_batch_1');
      expect(response.body.results[1].dedupeKey).toContain('instagram:17841400000000000:msg:m_igmsg_batch_2');

      logSpy.mockRestore();
    });

    it('deduplicates repeated message (fullyDeduped: true)', async () => {
      const app = buildApp();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const first = await request(app).post('/webhook').send(textMessage);
      expect(first.body.fullyDeduped).toBe(false);

      const second = await request(app).post('/webhook').send(textMessage);
      expect(second.status).toBe(200);
      expect(second.body.ok).toBe(true);
      expect(second.body.fullyDeduped).toBe(true);
      expect(second.body.summary.deduped).toBe(1);
      expect(second.body.summary.processed).toBe(0);

      logSpy.mockRestore();
    });

    it('rejects invalid webhook payload with 400', async () => {
      const app = buildApp();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const response = await request(app).post('/webhook').send({});
      expect(response.status).toBe(400);
      expect(response.body.ok).toBe(false);
      expect(response.body.code).toBe('WEBHOOK_VALIDATION_FAILED');
      logSpy.mockRestore();
    });

    it('preserves x-correlation-id from request', async () => {
      const app = buildApp();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const customCorrelationId = 'ig-cid-123';
      const response = await request(app)
        .post('/webhook')
        .set('x-correlation-id', customCorrelationId)
        .send(textMessage);

      expect(response.status).toBe(200);
      expect(response.headers['x-correlation-id']).toBe(customCorrelationId);
      expect(response.body.correlationId).toBe(customCorrelationId);

      logSpy.mockRestore();
    });

    it('does not log payload content (PII check)', async () => {
      const app = buildApp();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await request(app).post('/webhook').send(textMessage);

      const logs = logSpy.mock.calls.map((call) => JSON.stringify(call));
      const hasPayloadContent = logs.some((log) => log.includes('hello from ig dm'));
      expect(hasPayloadContent).toBe(false);

      logSpy.mockRestore();
    });
  });

  describe('signature validation', () => {
    const TEST_SECRET = 'instagram-test-secret';

    it('skips validation when INSTAGRAM_WEBHOOK_SECRET is not set', async () => {
      delete process.env.INSTAGRAM_WEBHOOK_SECRET;
      const app = buildApp();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const response = await request(app).post('/webhook').send(textMessage);
      expect(response.status).toBe(200);
      logSpy.mockRestore();
    });

    it('accepts valid signature when secret is set', async () => {
      process.env.INSTAGRAM_WEBHOOK_SECRET = TEST_SECRET;
      const app = buildApp();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const rawBody = JSON.stringify(textMessage);
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

      const rawBody = JSON.stringify(textMessage);
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

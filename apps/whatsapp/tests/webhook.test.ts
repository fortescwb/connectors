import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateHmacSha256 } from '@connectors/core-signature';

import { buildApp } from '../src/app.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_SECRET = 'whatsapp-test-secret-key';
const TEST_VERIFY_TOKEN = 'my-verify-token-123';

function loadFixture(name: string) {
  const filePath = path.join(__dirname, '..', '..', '..', 'packages', 'core-meta-whatsapp', 'fixtures', name);
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

describe('whatsapp app', () => {
  beforeEach(() => {
    delete process.env.WHATSAPP_WEBHOOK_SECRET;
    delete process.env.WHATSAPP_VERIFY_TOKEN;
  });

  afterEach(() => {
    delete process.env.WHATSAPP_WEBHOOK_SECRET;
    delete process.env.WHATSAPP_VERIFY_TOKEN;
    vi.restoreAllMocks();
  });

  it('responds 200 on /health', async () => {
    const app = await buildApp();
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', connector: 'whatsapp' });
  });

  describe('POST /webhook', () => {
    it('rejects invalid webhook payload with 400', async () => {
      const app = await buildApp();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const response = await request(app).post('/webhook').send({});

      expect(response.status).toBe(400);
      expect(response.body.ok).toBe(false);
      expect(response.body.code).toBe('WEBHOOK_VALIDATION_FAILED');
      expect(typeof response.body.correlationId).toBe('string');
      expect(response.headers['x-correlation-id']).toBe(response.body.correlationId);

      logSpy.mockRestore();
    });

    it('processes batch payload and returns summary with 200', async () => {
      const payload = loadFixture('message_batch.json');
      const app = await buildApp();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const response = await request(app).post('/webhook').send(payload);

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      expect(response.body.fullyDeduped).toBe(false);
      expect(response.body.summary).toEqual({ total: 3, processed: 3, deduped: 0, failed: 0 });
      expect(typeof response.body.correlationId).toBe('string');
      expect(response.headers['x-correlation-id']).toBe(response.body.correlationId);

      const logs = logSpy.mock.calls
        .map(([entry]) => {
          try {
            return JSON.parse(entry as string);
          } catch {
            return null;
          }
        })
        .filter(Boolean) as Record<string, unknown>[];

      const processedLogs = logs.filter((entry) => entry.message === 'Event processed successfully');
      expect(processedLogs).toHaveLength(3);
      expect(processedLogs[0]?.capabilityId).toBeDefined();

      logSpy.mockRestore();
    });

    it('dedupes repeated payloads across requests', async () => {
      const payload = loadFixture('message_duplicate.json');
      const app = await buildApp();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const first = await request(app).post('/webhook').send(payload);
      const second = await request(app).post('/webhook').send(payload);

      expect(first.status).toBe(200);
      expect(first.body.summary).toEqual({ total: 1, processed: 1, deduped: 0, failed: 0 });
      expect(first.body.fullyDeduped).toBe(false);

      expect(second.status).toBe(200);
      expect(second.body.summary).toEqual({ total: 1, processed: 0, deduped: 1, failed: 0 });
      expect(second.body.fullyDeduped).toBe(true);

      const logs = logSpy.mock.calls
        .map(([entry]) => {
          try {
            return JSON.parse(entry as string);
          } catch {
            return null;
          }
        })
        .filter(Boolean) as Record<string, unknown>[];

      const dedupeLog = logs.find((entry) => entry.message === 'Duplicate event skipped');
      expect(dedupeLog?.dedupeKey).toBe('whatsapp:441234567890:msg:wamid.DUPLICATE.123');
      expect(dedupeLog?.deduped).toBe(true);

      logSpy.mockRestore();
    });

    describe('signature validation', () => {
      it('skips signature validation when WHATSAPP_WEBHOOK_SECRET is not set', async () => {
        delete process.env.WHATSAPP_WEBHOOK_SECRET;
        const payload = loadFixture('message_duplicate.json');

        const app = await buildApp();
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        const response = await request(app).post('/webhook').send(payload);

        expect(response.status).toBe(200);
        expect(response.body.ok).toBe(true);
        expect(response.body.summary.total).toBe(1);

        const parsedLogs = logSpy.mock.calls
          .map(([value]) => {
            try {
              return JSON.parse(value as string);
            } catch {
              return {};
            }
          })
          .filter((entry) => entry.message === 'Signature validation skipped');

        expect(parsedLogs.length).toBe(1);
        logSpy.mockRestore();
      });

      it('accepts webhook with valid signature when secret is set', async () => {
        process.env.WHATSAPP_WEBHOOK_SECRET = TEST_SECRET;
        const payload = loadFixture('message_batch.json');
        const rawBody = JSON.stringify(payload);
        const signature = generateHmacSha256(TEST_SECRET, rawBody, 'sha256=');

        const app = await buildApp();
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        const response = await request(app)
          .post('/webhook')
          .set('Content-Type', 'application/json')
          .set('x-hub-signature-256', signature)
          .send(rawBody);

        expect(response.status).toBe(200);
        expect(response.body.ok).toBe(true);
        expect(response.body.summary.total).toBe(3);
        expect(typeof response.body.correlationId).toBe('string');
        expect(response.headers['x-correlation-id']).toBe(response.body.correlationId);

        logSpy.mockRestore();
      });

      it('rejects webhook with invalid signature when secret is set', async () => {
        process.env.WHATSAPP_WEBHOOK_SECRET = TEST_SECRET;
        const payload = loadFixture('message_batch.json');
        const rawBody = JSON.stringify(payload);
        const invalidSignature = generateHmacSha256('wrong-secret', rawBody, 'sha256=');

        const app = await buildApp();

        const response = await request(app)
          .post('/webhook')
          .set('Content-Type', 'application/json')
          .set('x-hub-signature-256', invalidSignature)
          .send(rawBody);

        expect(response.status).toBe(401);
        expect(response.body.ok).toBe(false);
        expect(response.body.code).toBe('UNAUTHORIZED');
        expect(response.body.message).toBe('Invalid signature');
      });

      it('rejects webhook with missing signature header when secret is set', async () => {
        process.env.WHATSAPP_WEBHOOK_SECRET = TEST_SECRET;
        const payload = loadFixture('message_batch.json');

        const app = await buildApp();

        const response = await request(app).post('/webhook').send(payload);

        expect(response.status).toBe(401);
        expect(response.body.ok).toBe(false);
        expect(response.body.code).toBe('UNAUTHORIZED');
        expect(response.body.message).toBe('Invalid signature');
      });
    });
  });

  describe('webhook verification (GET /webhook)', () => {
    it('returns 200 with challenge when verification is valid', async () => {
      process.env.WHATSAPP_VERIFY_TOKEN = TEST_VERIFY_TOKEN;

      const app = await buildApp();
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

      const app = await buildApp();
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

      const app = await buildApp();
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
      delete process.env.WHATSAPP_VERIFY_TOKEN;

      const app = await buildApp();
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
      const app = await buildApp();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const customCorrelationId = 'cid-test-123';
      const payload = loadFixture('message_duplicate.json');

      const response = await request(app)
        .post('/webhook')
        .set('x-correlation-id', customCorrelationId)
        .send(payload);

      expect(response.status).toBe(200);
      expect(response.headers['x-correlation-id']).toBe(customCorrelationId);
      expect(response.body.correlationId).toBe(customCorrelationId);

      logSpy.mockRestore();
    });

    it('generates correlationId when not provided in request', async () => {
      const app = await buildApp();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const payload = loadFixture('message_duplicate.json');

      const response = await request(app).post('/webhook').send(payload);

      expect(response.status).toBe(200);
      expect(typeof response.headers['x-correlation-id']).toBe('string');
      expect(response.headers['x-correlation-id'].length).toBeGreaterThan(0);
      expect(response.body.correlationId).toBe(response.headers['x-correlation-id']);

      logSpy.mockRestore();
    });

    it('preserves correlationId in 401 error response', async () => {
      process.env.WHATSAPP_WEBHOOK_SECRET = TEST_SECRET;

      const app = await buildApp();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const customCorrelationId = 'cid-error-test-456';
      const payload = loadFixture('message_batch.json');
      const rawBody = JSON.stringify(payload);

      const response = await request(app)
        .post('/webhook')
        .set('x-correlation-id', customCorrelationId)
        .set('x-hub-signature-256', 'sha256=invalid')
        .set('Content-Type', 'application/json')
        .send(rawBody);

      expect(response.status).toBe(401);
      expect(response.headers['x-correlation-id']).toBe(customCorrelationId);
      expect(response.body.correlationId).toBe(customCorrelationId);

      logSpy.mockRestore();
    });
  });
});

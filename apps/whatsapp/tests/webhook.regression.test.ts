import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestClient } from './helpers/http.js';
import { loadFixture, loadFixtureRaw } from './helpers/loadFixture.js';
import { signMetaPayload } from './helpers/signature.js';

const TEST_VERIFY_TOKEN = 'verify-token-regression';
const TEST_SECRET = 'whatsapp-secret-regression';

const PHONE_ID = 'PHONE_ID_001';

type ParsedLog = Record<string, unknown>;

const singleMessageFixtures = [
  { name: 'text', file: 'whatsapp/text.json', messageId: 'wamid.fake.text.001' },
  { name: 'audio', file: 'whatsapp/audio.json', messageId: 'wamid.fake.audio.001' },
  { name: 'document', file: 'whatsapp/document.json', messageId: 'wamid.fake.document.001' },
  { name: 'video', file: 'whatsapp/video.json', messageId: 'wamid.fake.video.001' },
  { name: 'sticker', file: 'whatsapp/sticker.json', messageId: 'wamid.fake.sticker.001' },
  { name: 'reaction', file: 'whatsapp/reaction.json', messageId: 'wamid.fake.reaction.001' },
  { name: 'template', file: 'whatsapp/template.json', messageId: 'wamid.fake.template.001' },
  { name: 'contact', file: 'whatsapp/contact.json', messageId: 'wamid.fake.contact.001' },
  { name: 'location', file: 'whatsapp/location.json', messageId: 'wamid.fake.location.001' }
] as const;

const piiStrings = [
  'Sample inbound text message',
  '15551230001',
  '15550009999',
  'john.doe@example.test',
  'Av. Paulista, 1000'
];

function resetEnv() {
  delete process.env.WHATSAPP_WEBHOOK_SECRET;
  delete process.env.WHATSAPP_VERIFY_TOKEN;
  delete process.env.REDIS_URL;
}

function captureLogs() {
  const entries: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    const serialized = args
      .map((arg) => {
        if (typeof arg === 'string') return arg;
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      })
      .join(' ');
    entries.push(serialized);
  });

  return {
    logs: entries,
    restore: () => spy.mockRestore()
  };
}

function parseJsonLogs(logs: string[]): ParsedLog[] {
  return logs
    .map((entry) => {
      try {
        return JSON.parse(entry) as ParsedLog;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as ParsedLog[];
}

function expectNoPiiInLogs(logs: string[]) {
  const serialized = logs.join(' ');
  for (const token of piiStrings) {
    expect(serialized).not.toContain(token);
  }
  expect(serialized).not.toContain('rawBody');
  expect(serialized).not.toContain('"body"');
}

describe('whatsapp webhook regression gate', () => {
  beforeEach(() => {
    resetEnv();
  });

  afterEach(() => {
    resetEnv();
    vi.restoreAllMocks();
  });

  describe('healthcheck', () => {
    it('returns service metadata', async () => {
      const client = await createTestClient();
      const response = await client.getHealth();

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ok', connector: 'whatsapp' });
    });
  });

  describe('GET /webhook verification', () => {
    it('returns challenge on valid subscribe', async () => {
      process.env.WHATSAPP_VERIFY_TOKEN = TEST_VERIFY_TOKEN;
      const client = await createTestClient();
      const challenge = 'challenge-token-123';

      const response = await client
        .getWebhook({
          'hub.mode': 'subscribe',
          'hub.verify_token': TEST_VERIFY_TOKEN,
          'hub.challenge': challenge
        });

      expect(response.status).toBe(200);
      expect(response.text).toBe(challenge);
      expect(response.type).toBe('text/plain');
      expect(typeof response.headers['x-correlation-id']).toBe('string');
    });

    it('rejects invalid verify token', async () => {
      process.env.WHATSAPP_VERIFY_TOKEN = TEST_VERIFY_TOKEN;
      const client = await createTestClient();

      const response = await client.getWebhook({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong-token',
        'hub.challenge': 'ignore'
      });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('FORBIDDEN');
      expect(response.body.ok).toBe(false);
      expect(response.headers['x-correlation-id']).toBe(response.body.correlationId);
    });

    it('rejects invalid mode', async () => {
      process.env.WHATSAPP_VERIFY_TOKEN = TEST_VERIFY_TOKEN;
      const client = await createTestClient();

      const response = await client.getWebhook({
        'hub.mode': 'unsubscribe',
        'hub.verify_token': TEST_VERIFY_TOKEN,
        'hub.challenge': 'ignore'
      });

      expect(response.status).toBe(403);
      expect(response.body.message).toBe('Invalid hub.mode');
      expect(response.body.ok).toBe(false);
    });

    it('returns 503 when verify token is not configured', async () => {
      const client = await createTestClient();

      const response = await client.getWebhook({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'any-token',
        'hub.challenge': 'challenge'
      });

      expect(response.status).toBe(503);
      expect(response.body.code).toBe('SERVICE_UNAVAILABLE');
      expect(response.body.ok).toBe(false);
    });
  });

  describe('POST /webhook single message fixtures', () => {
    it.each(singleMessageFixtures)('processes %s message through runtime', async ({ file, messageId }) => {
      const payload = await loadFixture<Record<string, unknown>>(file);
      const client = await createTestClient();
      const { logs, restore } = captureLogs();

      const response = await client.postWebhook(payload);
      restore();

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      expect(response.body.summary).toEqual({ total: 1, processed: 1, deduped: 0, failed: 0 });
      expect(response.body.fullyDeduped).toBe(false);
      expect(response.headers['x-correlation-id']).toBe(response.body.correlationId);

      const results = response.body.results;
      expect(Array.isArray(results)).toBe(true);
      expect(results).toHaveLength(1);
      expect(results[0]?.dedupeKey).toBe(`whatsapp:${PHONE_ID}:msg:${messageId}`);
      expect(results[0]?.ok).toBe(true);

      const parsedLogs = parseJsonLogs(logs);
      const successLog = parsedLogs.find((entry) => entry.message === 'Event processed successfully');
      expect(successLog?.dedupeKey).toBe(`whatsapp:${PHONE_ID}:msg:${messageId}`);

      expectNoPiiInLogs(logs);
    });
  });

  describe('POST /webhook mixed batch', () => {
    it('returns per-item results and batch summary', async () => {
      const payload = await loadFixture<Record<string, unknown>>('whatsapp/batch-mixed.json');
      const client = await createTestClient();
      const { logs, restore } = captureLogs();

      const response = await client.postWebhook(payload);
      restore();

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      expect(response.body.fullyDeduped).toBe(false);
      expect(response.body.summary).toEqual({ total: 5, processed: 5, deduped: 0, failed: 0 });
      expect(response.body.results).toHaveLength(5);

      const dedupeKeys = response.body.results.map((item: { dedupeKey: string }) => item.dedupeKey);
      expect(dedupeKeys).toContain('whatsapp:PHONE_ID_001:msg:wamid.mixed.text.001');
      expect(dedupeKeys).toContain('whatsapp:PHONE_ID_001:msg:wamid.mixed.location.005');

      const parsedLogs = parseJsonLogs(logs);
      const summaryLog = parsedLogs.find((entry) => entry.message === 'Inbound batch summary');
      expect(summaryLog?.total).toBe(5);
      expect(summaryLog?.deduped).toBe(0);
    });
  });

  describe('deduplication', () => {
    it('marks second identical payload as deduped', async () => {
      const payload = await loadFixture<Record<string, unknown>>('whatsapp/text.json');
      const client = await createTestClient();
      const { logs, restore } = captureLogs();

      const first = await client.postWebhook(payload);
      const second = await client.postWebhook(payload);
      restore();

      expect(first.status).toBe(200);
      expect(first.body.summary).toEqual({ total: 1, processed: 1, deduped: 0, failed: 0 });
      expect(first.body.fullyDeduped).toBe(false);

      expect(second.status).toBe(200);
      expect(second.body.summary).toEqual({ total: 1, processed: 0, deduped: 1, failed: 0 });
      expect(second.body.fullyDeduped).toBe(true);

      const parsedLogs = parseJsonLogs(logs);
      const dedupeLog = parsedLogs.find((entry) => entry.message === 'Duplicate event skipped');
      expect(dedupeLog?.deduped).toBe(true);
      expect(dedupeLog?.dedupeKey).toBe('whatsapp:PHONE_ID_001:msg:wamid.fake.text.001');
    });
  });

  describe('signature enforcement', () => {
    it('accepts valid signature when secret configured', async () => {
      process.env.WHATSAPP_WEBHOOK_SECRET = TEST_SECRET;
      const rawBody = await loadFixtureRaw('whatsapp/batch-mixed.json');
      const client = await createTestClient({ secret: TEST_SECRET });

      const response = await client.postWebhook(rawBody, { rawBody });

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      expect(response.body.summary.total).toBe(5);
    });

    it('rejects invalid signature', async () => {
      process.env.WHATSAPP_WEBHOOK_SECRET = TEST_SECRET;
      const payload = await loadFixture<Record<string, unknown>>('whatsapp/text.json');
      const rawBody = JSON.stringify(payload);
      const client = await createTestClient();
      const invalidSignature = signMetaPayload('wrong-secret', rawBody);

      const response = await client.postWebhook(rawBody, { rawBody, signature: invalidSignature });

      expect(response.status).toBe(401);
      expect(response.body.ok).toBe(false);
      expect(response.body.code).toBe('UNAUTHORIZED');
      expect(response.body.message).toBe('Invalid signature');
    });

    it('rejects missing signature header when secret is set', async () => {
      process.env.WHATSAPP_WEBHOOK_SECRET = TEST_SECRET;
      const payload = await loadFixture<Record<string, unknown>>('whatsapp/text.json');
      const client = await createTestClient();

      const response = await client.postWebhook(payload);

      expect(response.status).toBe(401);
      expect(response.body.ok).toBe(false);
      expect(response.body.code).toBe('UNAUTHORIZED');
    });
  });

  describe('validation errors', () => {
    it('returns 400 for malformed payload', async () => {
      const client = await createTestClient();
      const invalidPayload = { object: 'whatsapp_business_account', entry: [] };

      const response = await client.postWebhook(invalidPayload);

      expect(response.status).toBe(400);
      expect(response.body.ok).toBe(false);
      expect(response.body.code).toBe('WEBHOOK_VALIDATION_FAILED');
      expect(typeof response.body.correlationId).toBe('string');
      expect(response.headers['x-correlation-id']).toBe(response.body.correlationId);
    });
  });

  describe('correlation id propagation', () => {
    it('echoes incoming correlation id on success', async () => {
      const payload = await loadFixture<Record<string, unknown>>('whatsapp/text.json');
      const client = await createTestClient();
      const correlationId = 'cid-whatsapp-001';

      const response = await client.postWebhook(payload, { correlationId });

      expect(response.status).toBe(200);
      expect(response.headers['x-correlation-id']).toBe(correlationId);
      expect(response.body.correlationId).toBe(correlationId);
    });

    it('preserves correlation id on unauthorized', async () => {
      process.env.WHATSAPP_WEBHOOK_SECRET = TEST_SECRET;
      const payload = await loadFixture<Record<string, unknown>>('whatsapp/text.json');
      const rawBody = JSON.stringify(payload);
      const client = await createTestClient({ secret: TEST_SECRET });
      const correlationId = 'cid-whatsapp-unauth';

      const response = await client
        .postWebhook(rawBody, { correlationId, rawBody })
        .set('x-hub-signature-256', 'sha256=invalid');

      expect(response.status).toBe(401);
      expect(response.headers['x-correlation-id']).toBe(correlationId);
      expect(response.body.correlationId).toBe(correlationId);
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestClient } from './helpers/http.js';
import { loadFixture, loadFixtureRaw } from './helpers/loadFixture.js';
import { signMetaPayload } from './helpers/signature.js';

const TEST_SECRET = 'pii-logging-secret';

const piiTokens = [
  '15551230001', // sender phone
  '15550009999', // business phone
  'Fixture User', // name
  'Sample inbound text message', // message body
  'rawBody', // raw body marker
  'Bearer ' // token prefix (defense-in-depth)
];

function captureLogs() {
  const entries: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    entries.push(args.map(String).join(' '));
  });
  return {
    logs: entries,
    restore: () => spy.mockRestore()
  };
}

function expectNoPii(logs: string[]) {
  const combined = logs.join(' ');
  for (const token of piiTokens) {
    expect(combined.includes(token)).toBe(false);
  }
}

describe('whatsapp logging is PII-safe', () => {
  beforeEach(() => {
    delete process.env.WHATSAPP_WEBHOOK_SECRET;
    delete process.env.WHATSAPP_VERIFY_TOKEN;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.WHATSAPP_WEBHOOK_SECRET;
    delete process.env.WHATSAPP_VERIFY_TOKEN;
  });

  it('POST /webhook success logs metadata without payload/PII', async () => {
    const payload = await loadFixture('whatsapp/text.json');
    const client = await createTestClient();
    const { logs, restore } = captureLogs();

    const response = await client.postWebhook(payload);
    restore();

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);

    expectNoPii(logs);
    const combined = logs.join(' ');
    expect(combined).toContain('correlationId');
    expect(combined).toContain('dedupeKey');
  });

  it('POST /webhook dedupe path does not leak PII', async () => {
    const payload = await loadFixture('whatsapp/text.json');
    const client = await createTestClient();
    const { logs, restore } = captureLogs();

    await client.postWebhook(payload);
    await client.postWebhook(payload);
    restore();

    expectNoPii(logs);
    const combined = logs.join(' ');
    expect(combined).toContain('Duplicate event skipped');
  });

  it('POST /webhook invalid payload (400) logs safely', async () => {
    const client = await createTestClient();
    const { logs, restore } = captureLogs();

    const response = await client.postWebhook({});
    restore();

    expect(response.status).toBe(400);
    expectNoPii(logs);
  });

  it('POST /webhook invalid signature (401) logs safely', async () => {
    process.env.WHATSAPP_WEBHOOK_SECRET = TEST_SECRET;
    const rawBody = await loadFixtureRaw('whatsapp/text.json');
    const invalidSignature = signMetaPayload('wrong-secret', rawBody);
    const client = await createTestClient();
    const { logs, restore } = captureLogs();

    const response = await client
      .postWebhook(rawBody, { rawBody, signature: invalidSignature })
      .set('x-hub-signature-256', invalidSignature);
    restore();

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('UNAUTHORIZED');
    expectNoPii(logs);
  });
});

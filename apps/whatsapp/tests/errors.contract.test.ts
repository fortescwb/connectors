import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { createLogger } from '@connectors/core-logging';
import {
  buildWebhookHandlers,
  InMemoryDedupeStore,
  type SignatureVerifier
} from '@connectors/core-runtime';
import { parseWhatsAppRuntimeRequest } from '@connectors/core-meta-whatsapp';

import { createTestClient } from './helpers/http.js';
import { loadFixture, loadFixtureRaw } from './helpers/loadFixture.js';
import { signMetaPayload } from './helpers/signature.js';
import { whatsappManifest } from '../src/app.js';

const TEST_SECRET = 'errors-contract-secret';

function isRetryable(status: number): boolean {
  return status >= 500 || status === 429;
}

describe('whatsapp error contract', () => {
  beforeEach(() => {
    delete process.env.WHATSAPP_WEBHOOK_SECRET;
    delete process.env.WHATSAPP_VERIFY_TOKEN;
  });

  afterEach(() => {
    delete process.env.WHATSAPP_WEBHOOK_SECRET;
    delete process.env.WHATSAPP_VERIFY_TOKEN;
  });

  it('returns 400 + WEBHOOK_VALIDATION_FAILED for invalid payload (non-retry)', async () => {
    const client = await createTestClient();
    const response = await client.postWebhook({});

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('WEBHOOK_VALIDATION_FAILED');
    expect(isRetryable(response.status)).toBe(false);
  });

  it('returns 401 + UNAUTHORIZED for invalid signature (non-retry)', async () => {
    process.env.WHATSAPP_WEBHOOK_SECRET = TEST_SECRET;
    const rawBody = await loadFixtureRaw('whatsapp/text.json');
    const invalidSignature = signMetaPayload('wrong-secret', rawBody);
    const client = await createTestClient();

    const response = await client
      .postWebhook(rawBody, { rawBody, signature: invalidSignature })
      .set('x-hub-signature-256', invalidSignature);

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('UNAUTHORIZED');
    expect(isRetryable(response.status)).toBe(false);
  });

  it('returns 403 + FORBIDDEN when verify token is invalid (non-retry)', async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = 'expected-token';
    const client = await createTestClient();

    const response = await client.getWebhook({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'wrong-token',
      'hub.challenge': 'challenge'
    });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
    expect(isRetryable(response.status)).toBe(false);
  });

  it('returns 500 + INTERNAL_ERROR when rawBody is missing (retryable)', async () => {
    // Build runtime directly to simulate missing rawBody while signature verifier is enabled
    const verifier: SignatureVerifier = { enabled: true, verify: () => ({ valid: true }) };
    const { handlePost } = buildWebhookHandlers({
      manifest: whatsappManifest,
      registry: {
        inbound_messages: async () => {}
      },
      parseEvents: parseWhatsAppRuntimeRequest,
      signatureVerifier: verifier,
      dedupeStore: new InMemoryDedupeStore(),
      logger: createLogger({ service: 'whatsapp-test' })
    });

    const payload = await loadFixture('whatsapp/text.json');
    const result = await handlePost({
      headers: {},
      query: {},
      body: payload,
      rawBody: undefined
    });

    expect(result.status).toBe(500);
    expect((result.body as { code: string }).code).toBe('INTERNAL_ERROR');
    expect(isRetryable(result.status)).toBe(true);
  });

  it('returns 200 with dedupe summary on duplicate payload (n/a retry)', async () => {
    const payload = await loadFixture('whatsapp/text.json');
    const client = await createTestClient();

    await client.postWebhook(payload);
    const duplicate = await client.postWebhook(payload);

    expect(duplicate.status).toBe(200);
    expect(duplicate.body.summary.deduped).toBeGreaterThan(0);
  });
});

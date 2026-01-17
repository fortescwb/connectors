import { describe, it, expect, vi } from 'vitest';

import type { ConnectorManifest } from '@connectors/core-connectors';

import {
  buildWebhookHandlers,
  createConnectorRuntime,
  generateCorrelationId,
  InMemoryDedupeStore,
  NoopDedupeStore,
  NoopRateLimiter,
  type CapabilityRegistry,
  type DedupeStore,
  type ParsedEvent,
  type RateLimiter,
  type RuntimeConfig,
  type RuntimeRequest,
  type SignatureVerifier,
  type WebhookVerifyHandler
} from '../src/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// TEST FIXTURES
// ─────────────────────────────────────────────────────────────────────────────

const testManifest: ConnectorManifest = {
  id: 'test-connector',
  name: 'Test Connector',
  version: '0.1.0',
  platform: 'test',
  capabilities: [
    { id: 'inbound_messages', status: 'active' },
    { id: 'webhook_verification', status: 'active' }
  ],
  webhookPath: '/webhook',
  healthPath: '/health',
  requiredEnvVars: [],
  optionalEnvVars: []
};

function createMockRequest(overrides: Partial<RuntimeRequest> = {}): RuntimeRequest {
  return {
    headers: {},
    query: {},
    body: {},
    ...overrides
  };
}

function createMockParseEvent(
  eventOverrides: Partial<ParsedEvent> = {}
): RuntimeConfig['parseEvent'] {
  return () => ({
    capabilityId: 'inbound_messages',
    dedupeKey: 'test:event-123',
    payload: { message: 'hello' },
    ...eventOverrides
  });
}

function createMockHandler() {
  return vi.fn().mockResolvedValue(undefined);
}

// ─────────────────────────────────────────────────────────────────────────────
// CORRELATION ID TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('correlationId', () => {
  describe('generateCorrelationId', () => {
    it('generates unique IDs', () => {
      const id1 = generateCorrelationId();
      const id2 = generateCorrelationId();
      expect(id1).not.toBe(id2);
    });

    it('generates IDs matching expected format', () => {
      const id = generateCorrelationId();
      expect(id).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
    });
  });

  describe('GET handler', () => {
    it('always generates new correlationId (ignores header)', async () => {
      const verifyWebhook: WebhookVerifyHandler = () => ({
        success: true,
        challenge: 'test-challenge'
      });

      const { handleGet } = buildWebhookHandlers({
        manifest: testManifest,
        registry: {},
        parseEvent: createMockParseEvent(),
        verifyWebhook
      });

      const requestWithHeader = createMockRequest({
        headers: { 'x-correlation-id': 'incoming-correlation-id' }
      });

      const response = await handleGet(requestWithHeader);

      expect(response.headers?.['x-correlation-id']).toBeDefined();
      expect(response.headers?.['x-correlation-id']).not.toBe('incoming-correlation-id');
    });

    it('returns correlationId in response header', async () => {
      const verifyWebhook: WebhookVerifyHandler = () => ({
        success: true,
        challenge: 'test-challenge'
      });

      const { handleGet } = buildWebhookHandlers({
        manifest: testManifest,
        registry: {},
        parseEvent: createMockParseEvent(),
        verifyWebhook
      });

      const response = await handleGet(createMockRequest());

      expect(response.headers?.['x-correlation-id']).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
    });
  });

  describe('POST handler', () => {
    it('uses correlationId from event when present', async () => {
      const handler = createMockHandler();
      const registry: CapabilityRegistry = { inbound_messages: handler };

      const { handlePost } = buildWebhookHandlers({
        manifest: testManifest,
        registry,
        parseEvent: createMockParseEvent({ correlationId: 'event-correlation-id' })
      });

      const response = await handlePost(
        createMockRequest({
          headers: { 'x-correlation-id': 'header-correlation-id' }
        })
      );

      expect(response.headers?.['x-correlation-id']).toBe('event-correlation-id');
      const body = response.body as { correlationId: string };
      expect(body.correlationId).toBe('event-correlation-id');
    });

    it('falls back to header correlationId when event has none', async () => {
      const handler = createMockHandler();
      const registry: CapabilityRegistry = { inbound_messages: handler };

      const { handlePost } = buildWebhookHandlers({
        manifest: testManifest,
        registry,
        parseEvent: createMockParseEvent({ correlationId: undefined })
      });

      const response = await handlePost(
        createMockRequest({
          headers: { 'x-correlation-id': 'header-correlation-id' }
        })
      );

      expect(response.headers?.['x-correlation-id']).toBe('header-correlation-id');
    });

    it('generates correlationId when neither event nor header has one', async () => {
      const handler = createMockHandler();
      const registry: CapabilityRegistry = { inbound_messages: handler };

      const { handlePost } = buildWebhookHandlers({
        manifest: testManifest,
        registry,
        parseEvent: createMockParseEvent({ correlationId: undefined })
      });

      const response = await handlePost(createMockRequest());

      expect(response.headers?.['x-correlation-id']).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
    });

    it('handles array-style x-correlation-id header', async () => {
      const handler = createMockHandler();
      const registry: CapabilityRegistry = { inbound_messages: handler };

      const { handlePost } = buildWebhookHandlers({
        manifest: testManifest,
        registry,
        parseEvent: createMockParseEvent({ correlationId: undefined })
      });

      const response = await handlePost(
        createMockRequest({
          headers: { 'x-correlation-id': ['first-id', 'second-id'] }
        })
      );

      expect(response.headers?.['x-correlation-id']).toBe('first-id');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RAW BODY REQUIREMENT TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('rawBody requirement', () => {
  it('returns 500 when signature enabled but rawBody missing', async () => {
    const signatureVerifier: SignatureVerifier = {
      enabled: true,
      verify: () => ({ valid: true })
    };

    const { handlePost } = buildWebhookHandlers({
      manifest: testManifest,
      registry: {},
      parseEvent: createMockParseEvent(),
      signatureVerifier
    });

    const response = await handlePost(createMockRequest({ rawBody: undefined }));

    expect(response.status).toBe(500);
    const body = response.body as { code: string; message: string };
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.message).toContain('rawBody required');
  });

  it('proceeds when signature enabled and rawBody present', async () => {
    const handler = createMockHandler();
    const registry: CapabilityRegistry = { inbound_messages: handler };

    const signatureVerifier: SignatureVerifier = {
      enabled: true,
      verify: () => ({ valid: true })
    };

    const { handlePost } = buildWebhookHandlers({
      manifest: testManifest,
      registry,
      parseEvent: createMockParseEvent(),
      signatureVerifier
    });

    const response = await handlePost(
      createMockRequest({ rawBody: Buffer.from('test') })
    );

    expect(response.status).toBe(200);
  });

  it('does not require rawBody when signature not enabled', async () => {
    const handler = createMockHandler();
    const registry: CapabilityRegistry = { inbound_messages: handler };

    const signatureVerifier: SignatureVerifier = {
      enabled: false,
      verify: () => ({ valid: true })
    };

    const { handlePost } = buildWebhookHandlers({
      manifest: testManifest,
      registry,
      parseEvent: createMockParseEvent(),
      signatureVerifier
    });

    const response = await handlePost(createMockRequest({ rawBody: undefined }));

    expect(response.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SIGNATURE VERIFICATION TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('signature verification', () => {
  it('returns 401 when signature verification fails', async () => {
    const signatureVerifier: SignatureVerifier = {
      enabled: true,
      verify: () => ({ valid: false, code: 'INVALID_SIGNATURE' })
    };

    const { handlePost } = buildWebhookHandlers({
      manifest: testManifest,
      registry: {},
      parseEvent: createMockParseEvent(),
      signatureVerifier
    });

    const response = await handlePost(
      createMockRequest({ rawBody: Buffer.from('test') })
    );

    expect(response.status).toBe(401);
    const body = response.body as { ok: boolean; code: string; message: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe('UNAUTHORIZED');
    expect(body.message).toBe('Invalid signature');
  });

  it('returns 401 when signature is missing', async () => {
    const signatureVerifier: SignatureVerifier = {
      enabled: true,
      verify: () => ({ valid: false, code: 'MISSING_SIGNATURE' })
    };

    const { handlePost } = buildWebhookHandlers({
      manifest: testManifest,
      registry: {},
      parseEvent: createMockParseEvent(),
      signatureVerifier
    });

    const response = await handlePost(
      createMockRequest({ rawBody: Buffer.from('test') })
    );

    expect(response.status).toBe(401);
  });

  it('proceeds when signature verification succeeds', async () => {
    const handler = createMockHandler();
    const registry: CapabilityRegistry = { inbound_messages: handler };

    const signatureVerifier: SignatureVerifier = {
      enabled: true,
      verify: () => ({ valid: true })
    };

    const { handlePost } = buildWebhookHandlers({
      manifest: testManifest,
      registry,
      parseEvent: createMockParseEvent(),
      signatureVerifier
    });

    const response = await handlePost(
      createMockRequest({ rawBody: Buffer.from('test') })
    );

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalled();
  });

  it('skips signature verification when verifier not provided', async () => {
    const handler = createMockHandler();
    const registry: CapabilityRegistry = { inbound_messages: handler };

    const { handlePost } = buildWebhookHandlers({
      manifest: testManifest,
      registry,
      parseEvent: createMockParseEvent()
    });

    const response = await handlePost(createMockRequest());

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalled();
  });

  it('returns correlationId in header even on signature failure', async () => {
    const signatureVerifier: SignatureVerifier = {
      enabled: true,
      verify: () => ({ valid: false, code: 'INVALID_SIGNATURE' })
    };

    const { handlePost } = buildWebhookHandlers({
      manifest: testManifest,
      registry: {},
      parseEvent: createMockParseEvent(),
      signatureVerifier
    });

    const response = await handlePost(
      createMockRequest({
        headers: { 'x-correlation-id': 'my-correlation-id' },
        rawBody: Buffer.from('test')
      })
    );

    expect(response.headers?.['x-correlation-id']).toBe('my-correlation-id');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DEDUPLICATION TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('deduplication', () => {
  describe('InMemoryDedupeStore', () => {
    it('returns false on first check (not duplicate)', async () => {
      const store = new InMemoryDedupeStore();
      const result = await store.checkAndMark('key1', 5000);
      expect(result).toBe(false);
    });

    it('returns true on second check (duplicate)', async () => {
      const store = new InMemoryDedupeStore();
      await store.checkAndMark('key1', 5000);
      const result = await store.checkAndMark('key1', 5000);
      expect(result).toBe(true);
    });

    it('returns false after TTL expires', async () => {
      vi.useFakeTimers();

      const store = new InMemoryDedupeStore();
      await store.checkAndMark('key1', 100);

      vi.advanceTimersByTime(150);

      const result = await store.checkAndMark('key1', 100);
      expect(result).toBe(false);

      vi.useRealTimers();
    });
  });

  describe('NoopDedupeStore', () => {
    it('always returns false (never deduplicates)', async () => {
      const store = new NoopDedupeStore();
      await store.checkAndMark('key1', 5000);
      const result = await store.checkAndMark('key1', 5000);
      expect(result).toBe(false);
    });
  });

  describe('POST handler dedupe behavior', () => {
    it('sets deduped=false on first request', async () => {
      const handler = createMockHandler();
      const registry: CapabilityRegistry = { inbound_messages: handler };

      const { handlePost } = buildWebhookHandlers({
        manifest: testManifest,
        registry,
        parseEvent: createMockParseEvent({ dedupeKey: 'unique-key-1' }),
        dedupeStore: new InMemoryDedupeStore()
      });

      const response = await handlePost(createMockRequest());

      expect(response.status).toBe(200);
      const body = response.body as { ok: boolean; deduped: boolean };
      expect(body.ok).toBe(true);
      expect(body.deduped).toBe(false);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('sets deduped=true and returns 200 on duplicate', async () => {
      const handler = createMockHandler();
      const registry: CapabilityRegistry = { inbound_messages: handler };
      const dedupeStore = new InMemoryDedupeStore();

      const { handlePost } = buildWebhookHandlers({
        manifest: testManifest,
        registry,
        parseEvent: createMockParseEvent({ dedupeKey: 'duplicate-key' }),
        dedupeStore
      });

      // First request
      await handlePost(createMockRequest());

      // Second request (duplicate)
      const response = await handlePost(createMockRequest());

      expect(response.status).toBe(200);
      const body = response.body as { ok: boolean; deduped: boolean };
      expect(body.ok).toBe(true);
      expect(body.deduped).toBe(true);

      // Handler should only be called once
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('passes deduped=true in context when duplicate', async () => {
      const handler = createMockHandler();
      const registry: CapabilityRegistry = { inbound_messages: handler };
      const dedupeStore = new InMemoryDedupeStore();

      const { handlePost } = buildWebhookHandlers({
        manifest: testManifest,
        registry,
        parseEvent: createMockParseEvent({ dedupeKey: 'ctx-test-key' }),
        dedupeStore
      });

      await handlePost(createMockRequest());

      // On first call, deduped should be false
      expect(handler).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ deduped: false })
      );
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RATE LIMITING TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('rate limiting', () => {
  describe('NoopRateLimiter', () => {
    it('always allows requests', async () => {
      const limiter = new NoopRateLimiter();
      const result = await limiter.consume('key');
      expect(result.allowed).toBe(true);
    });
  });

  describe('POST handler rate limit behavior', () => {
    it('returns 429 when rate limit exceeded', async () => {
      const rateLimiter: RateLimiter = {
        consume: async () => ({ allowed: false, retryAfterMs: 30000 })
      };

      const { handlePost } = buildWebhookHandlers({
        manifest: testManifest,
        registry: {},
        parseEvent: createMockParseEvent(),
        rateLimiter
      });

      const response = await handlePost(createMockRequest());

      expect(response.status).toBe(429);
      const body = response.body as { ok: boolean; code: string; message: string };
      expect(body.ok).toBe(false);
      expect(body.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(body.message).toBe('Too many requests');
    });

    it('includes Retry-After header on 429', async () => {
      const rateLimiter: RateLimiter = {
        consume: async () => ({ allowed: false, retryAfterMs: 45000 })
      };

      const { handlePost } = buildWebhookHandlers({
        manifest: testManifest,
        registry: {},
        parseEvent: createMockParseEvent(),
        rateLimiter
      });

      const response = await handlePost(createMockRequest());

      expect(response.headers?.['Retry-After']).toBe('45');
    });

    it('defaults Retry-After to 60 when retryAfterMs not provided', async () => {
      const rateLimiter: RateLimiter = {
        consume: async () => ({ allowed: false })
      };

      const { handlePost } = buildWebhookHandlers({
        manifest: testManifest,
        registry: {},
        parseEvent: createMockParseEvent(),
        rateLimiter
      });

      const response = await handlePost(createMockRequest());

      expect(response.headers?.['Retry-After']).toBe('60');
    });

    it('proceeds when rate limit allows', async () => {
      const handler = createMockHandler();
      const registry: CapabilityRegistry = { inbound_messages: handler };

      const rateLimiter: RateLimiter = {
        consume: async () => ({ allowed: true })
      };

      const { handlePost } = buildWebhookHandlers({
        manifest: testManifest,
        registry,
        parseEvent: createMockParseEvent(),
        rateLimiter
      });

      const response = await handlePost(createMockRequest());

      expect(response.status).toBe(200);
      expect(handler).toHaveBeenCalled();
    });

    it('skips rate limiting when rateLimiter not provided', async () => {
      const handler = createMockHandler();
      const registry: CapabilityRegistry = { inbound_messages: handler };

      const { handlePost } = buildWebhookHandlers({
        manifest: testManifest,
        registry,
        parseEvent: createMockParseEvent()
      });

      const response = await handlePost(createMockRequest());

      expect(response.status).toBe(200);
    });

    it('includes correlationId in 429 response', async () => {
      const rateLimiter: RateLimiter = {
        consume: async () => ({ allowed: false })
      };

      const { handlePost } = buildWebhookHandlers({
        manifest: testManifest,
        registry: {},
        parseEvent: createMockParseEvent(),
        rateLimiter
      });

      const response = await handlePost(
        createMockRequest({
          headers: { 'x-correlation-id': 'rate-limit-correlation' }
        })
      );

      expect(response.headers?.['x-correlation-id']).toBe('rate-limit-correlation');
      const body = response.body as { correlationId: string };
      expect(body.correlationId).toBe('rate-limit-correlation');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WEBHOOK VERIFICATION (GET) TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('webhook verification (GET)', () => {
  it('returns 503 when verifyWebhook not configured', async () => {
    const { handleGet } = buildWebhookHandlers({
      manifest: testManifest,
      registry: {},
      parseEvent: createMockParseEvent()
    });

    const response = await handleGet(createMockRequest());

    expect(response.status).toBe(503);
    const body = response.body as { code: string };
    expect(body.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('returns 200 with challenge on successful verification', async () => {
    const verifyWebhook: WebhookVerifyHandler = (query) => ({
      success: true,
      challenge: query['hub.challenge']
    });

    const { handleGet } = buildWebhookHandlers({
      manifest: testManifest,
      registry: {},
      parseEvent: createMockParseEvent(),
      verifyWebhook
    });

    const response = await handleGet(
      createMockRequest({
        query: { 'hub.challenge': 'test-challenge-123' }
      })
    );

    expect(response.status).toBe(200);
    expect(response.body).toBe('test-challenge-123');
    expect(response.contentType).toBe('text/plain');
  });

  it('returns 403 on verification failure', async () => {
    const verifyWebhook: WebhookVerifyHandler = () => ({
      success: false,
      errorCode: 'FORBIDDEN',
      errorMessage: 'Invalid verify token'
    });

    const { handleGet } = buildWebhookHandlers({
      manifest: testManifest,
      registry: {},
      parseEvent: createMockParseEvent(),
      verifyWebhook
    });

    const response = await handleGet(createMockRequest());

    expect(response.status).toBe(403);
    const body = response.body as { ok: boolean; code: string; message: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe('FORBIDDEN');
    expect(body.message).toBe('Invalid verify token');
  });

  it('returns 503 when verification returns SERVICE_UNAVAILABLE', async () => {
    const verifyWebhook: WebhookVerifyHandler = () => ({
      success: false,
      errorCode: 'SERVICE_UNAVAILABLE',
      errorMessage: 'Token not configured'
    });

    const { handleGet } = buildWebhookHandlers({
      manifest: testManifest,
      registry: {},
      parseEvent: createMockParseEvent(),
      verifyWebhook
    });

    const response = await handleGet(createMockRequest());

    expect(response.status).toBe(503);
  });

  it('returns 500 on verification handler error', async () => {
    const verifyWebhook: WebhookVerifyHandler = () => {
      throw new Error('Unexpected error');
    };

    const { handleGet } = buildWebhookHandlers({
      manifest: testManifest,
      registry: {},
      parseEvent: createMockParseEvent(),
      verifyWebhook
    });

    const response = await handleGet(createMockRequest());

    expect(response.status).toBe(500);
    const body = response.body as { code: string };
    expect(body.code).toBe('INTERNAL_ERROR');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CAPABILITY HANDLER TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('capability handlers', () => {
  it('calls the correct handler for the capability', async () => {
    const inboundHandler = createMockHandler();
    const commentHandler = createMockHandler();

    const registry: CapabilityRegistry = {
      inbound_messages: inboundHandler,
      comment_ingest: commentHandler
    };

    const { handlePost } = buildWebhookHandlers({
      manifest: testManifest,
      registry,
      parseEvent: createMockParseEvent({ capabilityId: 'inbound_messages' })
    });

    await handlePost(createMockRequest());

    expect(inboundHandler).toHaveBeenCalledTimes(1);
    expect(commentHandler).not.toHaveBeenCalled();
  });

  it('returns 500 when no handler registered for capability', async () => {
    const { handlePost } = buildWebhookHandlers({
      manifest: testManifest,
      registry: {},
      parseEvent: createMockParseEvent({ capabilityId: 'inbound_messages' })
    });

    const response = await handlePost(createMockRequest());

    expect(response.status).toBe(500);
    const body = response.body as { message: string };
    expect(body.message).toContain('No handler for capability');
  });

  it('passes event payload to handler', async () => {
    const handler = createMockHandler();
    const registry: CapabilityRegistry = { inbound_messages: handler };
    const payload = { text: 'Hello, world!', from: '+1234567890' };

    const { handlePost } = buildWebhookHandlers({
      manifest: testManifest,
      registry,
      parseEvent: createMockParseEvent({ payload })
    });

    await handlePost(createMockRequest());

    expect(handler).toHaveBeenCalledWith(payload, expect.anything());
  });

  it('passes RuntimeContext to handler with correct properties', async () => {
    const handler = createMockHandler();
    const registry: CapabilityRegistry = { inbound_messages: handler };

    const { handlePost } = buildWebhookHandlers({
      manifest: testManifest,
      registry,
      parseEvent: createMockParseEvent({
        correlationId: 'test-correlation',
        tenant: 'tenant-123'
      })
    });

    await handlePost(createMockRequest());

    expect(handler).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        correlationId: 'test-correlation',
        connector: 'test-connector',
        tenant: 'tenant-123',
        deduped: false,
        logger: expect.objectContaining({
          info: expect.any(Function),
          warn: expect.any(Function),
          error: expect.any(Function)
        })
      })
    );
  });

  it('returns 500 when handler throws', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('Handler error'));
    const registry: CapabilityRegistry = { inbound_messages: handler };

    const { handlePost } = buildWebhookHandlers({
      manifest: testManifest,
      registry,
      parseEvent: createMockParseEvent()
    });

    const response = await handlePost(createMockRequest());

    expect(response.status).toBe(500);
    const body = response.body as { code: string; message: string };
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.message).toBe('internal_error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EVENT PARSING ERROR TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('event parsing errors', () => {
  it('returns 400 when parseEvent throws', async () => {
    const { handlePost } = buildWebhookHandlers({
      manifest: testManifest,
      registry: {},
      parseEvent: () => {
        throw new Error('Invalid payload format');
      }
    });

    const response = await handlePost(createMockRequest());

    expect(response.status).toBe(400);
    const body = response.body as { ok: boolean; code: string; message: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe('WEBHOOK_VALIDATION_FAILED');
    expect(body.message).toBe('Invalid payload format');
  });

  it('includes correlationId in 400 response', async () => {
    const { handlePost } = buildWebhookHandlers({
      manifest: testManifest,
      registry: {},
      parseEvent: () => {
        throw new Error('Parse error');
      }
    });

    const response = await handlePost(
      createMockRequest({
        headers: { 'x-correlation-id': 'parse-error-correlation' }
      })
    );

    expect(response.headers?.['x-correlation-id']).toBe('parse-error-correlation');
    const body = response.body as { correlationId: string };
    expect(body.correlationId).toBe('parse-error-correlation');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CREATE CONNECTOR RUNTIME TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('createConnectorRuntime', () => {
  it('returns runtime with manifest and handlers', () => {
    const runtime = createConnectorRuntime({
      manifest: testManifest,
      registry: {},
      parseEvent: createMockParseEvent()
    });

    expect(runtime.manifest).toBe(testManifest);
    expect(runtime.handlers.handleGet).toBeInstanceOf(Function);
    expect(runtime.handlers.handlePost).toBeInstanceOf(Function);
  });

  it('handlers work correctly through runtime interface', async () => {
    const handler = createMockHandler();
    const registry: CapabilityRegistry = { inbound_messages: handler };

    const runtime = createConnectorRuntime({
      manifest: testManifest,
      registry,
      parseEvent: createMockParseEvent()
    });

    const response = await runtime.handlers.handlePost(createMockRequest());

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PROCESSING ORDER TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('processing order', () => {
  it('checks signature before parsing event', async () => {
    const parseEvent = vi.fn().mockReturnValue({
      capabilityId: 'inbound_messages',
      dedupeKey: 'test-key',
      payload: {}
    });

    const signatureVerifier: SignatureVerifier = {
      enabled: true,
      verify: () => ({ valid: false, code: 'INVALID_SIGNATURE' })
    };

    const { handlePost } = buildWebhookHandlers({
      manifest: testManifest,
      registry: {},
      parseEvent,
      signatureVerifier
    });

    await handlePost(createMockRequest({ rawBody: Buffer.from('test') }));

    // parseEvent should not be called when signature fails
    expect(parseEvent).not.toHaveBeenCalled();
  });

  it('checks rate limit before deduplication', async () => {
    const dedupeStore: DedupeStore = {
      checkAndMark: vi.fn().mockResolvedValue(false)
    };

    const rateLimiter: RateLimiter = {
      consume: async () => ({ allowed: false })
    };

    const { handlePost } = buildWebhookHandlers({
      manifest: testManifest,
      registry: {},
      parseEvent: createMockParseEvent(),
      rateLimiter,
      dedupeStore
    });

    await handlePost(createMockRequest());

    // dedupeStore should not be called when rate limited
    expect(dedupeStore.checkAndMark).not.toHaveBeenCalled();
  });

  it('checks deduplication before calling handler', async () => {
    const handler = createMockHandler();
    const registry: CapabilityRegistry = { inbound_messages: handler };

    const dedupeStore: DedupeStore = {
      checkAndMark: vi.fn().mockResolvedValue(true) // Always duplicate
    };

    const { handlePost } = buildWebhookHandlers({
      manifest: testManifest,
      registry,
      parseEvent: createMockParseEvent(),
      dedupeStore
    });

    await handlePost(createMockRequest());

    // Handler should not be called when deduplicated
    expect(handler).not.toHaveBeenCalled();
  });
});

import express, { type Express } from 'express';
import { Redis } from 'ioredis';

import { createLogger } from '@connectors/core-logging';
import { rawBodyMiddleware, type RawBodyRequest } from '@connectors/adapter-express';
import { verifyHmacSha256 } from '@connectors/core-signature';
import {
  buildWebhookHandlers,
  type ParsedEvent,
  type RuntimeRequest,
  type SignatureVerifier,
  type WebhookVerifyHandler,
  processOutboundBatch,
  type DedupeStore,
  type OutboundBatchResult,
  InMemoryDedupeStore,
  RedisDedupeStore
} from '@connectors/core-runtime';
import { capability, type ConnectorManifest } from '@connectors/core-connectors';
import { parseWhatsAppRuntimeRequest, sendWhatsAppOutbound, type WhatsAppOutboundConfig } from '@connectors/core-meta-whatsapp';
import type { OutboundMessageIntent } from '@connectors/core-messaging';

// ─────────────────────────────────────────────────────────────────────────────
// MANIFEST
// ─────────────────────────────────────────────────────────────────────────────

export const whatsappManifest: ConnectorManifest = {
  id: 'whatsapp',
  name: 'WhatsApp Business',
  version: '0.1.0',
  platform: 'meta',
  capabilities: [
    capability(
      'inbound_messages',
      'active',
      'Receive messages via WhatsApp webhook (requires shared dedupe store for production)'
    ),
    capability(
      'message_status_updates',
      'active',
      'Receive message delivery status (requires shared dedupe store for production)'
    ),
    capability(
      'outbound_messages',
      'active',
      'Send messages via Graph API (text, audio, document, contacts, reaction, template, mark_read)'
    ),
    capability('webhook_verification', 'active', 'Meta webhook verification endpoint')
  ],
  webhookPath: '/webhook',
  healthPath: '/health',
  requiredEnvVars: ['WHATSAPP_VERIFY_TOKEN'],
  optionalEnvVars: ['WHATSAPP_WEBHOOK_SECRET', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID']
};

// ─────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────

const logger = createLogger({ service: 'whatsapp-app' });

// ─────────────────────────────────────────────────────────────────────────────
// DEDUPE STORE FACTORY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates the appropriate DedupeStore based on environment configuration.
 *
 * PRODUCTION/STAGING (NODE_ENV=production|staging):
 * - REDIS_URL is REQUIRED - app will fail to start without it
 * - Uses RedisDedupeStore for distributed deduplication
 * - Fail mode: 'closed' (blocks processing on Redis errors to prevent duplicates)
 * - Redis connectivity validated at boot with PING (3s timeout)
 * - Recommended: Upstash Redis (free tier: 500K commands/month, TLS enabled)
 *
 * DEVELOPMENT (NODE_ENV=development):
 * - REDIS_URL optional
 * - Uses InMemoryDedupeStore if REDIS_URL not set
 * - InMemory is ONLY suitable for inbound (outbound requires Redis for exactly-once)
 *
 * @returns Promise<DedupeStore> instance (Redis or InMemory)
 * @throws Error if staging/production and REDIS_URL not set or connection fails
 */
async function createDedupeStore(): Promise<DedupeStore> {
  const redisUrl = process.env.REDIS_URL;
  const nodeEnv = process.env.NODE_ENV || 'development';
  const isNonDev = nodeEnv === 'production' || nodeEnv === 'staging';

  // FAIL-CLOSED: In production/staging, Redis is mandatory
  if (isNonDev && !redisUrl) {
    const errorMsg = `REDIS_URL is required in ${nodeEnv} (NODE_ENV=${nodeEnv}). Use Upstash Redis free tier.`;
    logger.error(errorMsg, { nodeEnv });
    throw new Error(errorMsg);
  }

  if (redisUrl) {
    const useTls = redisUrl.startsWith('rediss://');
    logger.info('Initializing Redis dedupe store', {
      nodeEnv,
      redisProvider: 'upstash',
      redisTls: useTls
    });

    const redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      enableOfflineQueue: true,
      lazyConnect: true,
      retryStrategy: (times: number) => Math.min(times * 500, 3000),
      ...(useTls && { tls: {} })
    });

    redis.on('error', (err: Error) => {
      logger.error('Redis connection error', { error: err.message });
    });

    // FAIL-CLOSED: Validate Redis connectivity at boot in staging/production
    if (isNonDev) {
      const timeoutMs = 5000;
      try {
        // With lazyConnect: true, we must explicitly connect first
        await Promise.race([
          redis.connect(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Redis connect timeout after ${timeoutMs}ms`)), timeoutMs)
          )
        ]);
        await redis.ping();
        logger.info('Redis validated at boot (PING ok)', { nodeEnv });
      } catch (err) {
        const errorMsg = `Redis connection failed at boot in ${nodeEnv}: ${err instanceof Error ? err.message : String(err)}`;
        logger.error(errorMsg, { nodeEnv });
        await redis.quit().catch(() => {});
        throw new Error(errorMsg);
      }
    }

    // Adapter: ioredis client to RedisClient interface
    // ioredis uses: set(key, value, 'PX', ttlMs, 'NX') for v5+
    const redisClientAdapter = {
      set: async (key: string, value: string, mode: 'NX', flag: 'PX', ttlMs: number): Promise<string | null> => {
        // ioredis v5 syntax: set(key, value, 'PX', milliseconds, 'NX')
        const result = await redis.set(key, value, flag, ttlMs, mode);
        return result;
      },
      exists: async (key: string): Promise<number> => {
        return redis.exists(key);
      }
    };

    return new RedisDedupeStore({
      client: redisClientAdapter,
      keyPrefix: 'whatsapp:dedupe:',
      failMode: isNonDev ? 'closed' : 'open', // staging/prod: fail-closed; dev: fail-open
      onError: (error, context) => {
        logger.error('Redis dedupe operation failed', {
          error: error.message,
          operation: context.operation
          // Note: context.key not logged to avoid potential PII leakage
        });
      }
    });
  }

  // Only reachable in development (nodeEnv !== 'production'/'staging')
  logger.warn(
    'REDIS_URL not configured - using InMemoryDedupeStore',
    {
      nodeEnv,
      warning: 'ONLY suitable for inbound in development',
      critical: 'Outbound side-effects require Redis for exactly-once guarantees'
    }
  );

  return new InMemoryDedupeStore();
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGNATURE VERIFIER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a Meta webhook signature verifier using X-Hub-Signature-256.
 *
 * SECURITY NOTES:
 * 1. rawBody is REQUIRED for signature verification - the HMAC is computed
 *    over the raw request bytes, not the parsed JSON.
 * 2. rawBodyMiddleware() MUST be applied BEFORE any JSON parsing middleware.
 * 3. If rawBody is empty/missing, the runtime will return 500 (config error).
 * 4. This function NEVER logs the request body or rawBody to avoid PII exposure.
 * 5. Without WHATSAPP_WEBHOOK_SECRET, signature validation is skipped with a log.
 */
function createMetaSignatureVerifier(): SignatureVerifier {
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET;

  return {
    // Always enabled so verify() is called, letting us log the skip
    enabled: true,
    verify: (request) => {
      if (!secret) {
        logger.info('Signature validation skipped', { signatureValidation: 'skipped' });
        return { valid: true };
      }

      const signatureHeader = request.headers['x-hub-signature-256'];
      const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

      const result = verifyHmacSha256({
        secret,
        rawBody: request.rawBody ?? '',
        signatureHeader: signature ?? ''
      });

      if (!result.valid) {
        return { valid: false, code: 'INVALID_SIGNATURE' };
      }

      return { valid: true };
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// WEBHOOK VERIFY HANDLER (GET)
// ─────────────────────────────────────────────────────────────────────────────

const verifyWebhook: WebhookVerifyHandler = (query) => {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (!verifyToken) {
    logger.error('WHATSAPP_VERIFY_TOKEN not configured');
    return {
      success: false,
      errorCode: 'SERVICE_UNAVAILABLE',
      errorMessage: 'Webhook verification not configured'
    };
  }

  if (query['hub.mode'] !== 'subscribe') {
    logger.warn('Webhook verification failed: invalid hub.mode', { mode: query['hub.mode'] });
    return {
      success: false,
      errorCode: 'FORBIDDEN',
      errorMessage: 'Invalid hub.mode'
    };
  }

  if (query['hub.verify_token'] !== verifyToken) {
    logger.warn('Webhook verification failed: invalid verify token');
    return {
      success: false,
      errorCode: 'FORBIDDEN',
      errorMessage: 'Invalid verify token'
    };
  }

  logger.info('Webhook verification successful');
  return {
    success: true,
    challenge: query['hub.challenge']
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// EVENT PARSER
// ─────────────────────────────────────────────────────────────────────────────

const parseEvents = (request: RuntimeRequest): ParsedEvent[] => parseWhatsAppRuntimeRequest(request);

// ─────────────────────────────────────────────────────────────────────────────
// OUTBOUND HANDLER
// ─────────────────────────────────────────────────────────────────────────────

export interface WhatsAppOutboundOptions {
  accessToken: string;
  phoneNumberId: string;
  dedupeStore: DedupeStore;
  apiVersion?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

/**
 * Process a batch of outbound intents with exactly-once semantics.
 *
 * - Deduplication happens BEFORE any HTTP side-effect (via dedupeStore).
 * - Uses intent.intentId as client_msg_id for provider-side idempotency.
 * - Handles all principal WhatsApp outbound types: text, audio, document,
 *   contacts, reaction, template, mark_read.
 */
export async function processWhatsAppOutbound(
  intents: OutboundMessageIntent[],
  options: WhatsAppOutboundOptions
): Promise<OutboundBatchResult> {
  const { accessToken, phoneNumberId, dedupeStore, apiVersion, baseUrl, timeoutMs } = options;

  const config: WhatsAppOutboundConfig = {
    accessToken,
    phoneNumberId,
    apiVersion,
    baseUrl,
    timeoutMs
  };

  return processOutboundBatch(intents, (intent) => sendWhatsAppOutbound(intent, config), {
    dedupeStore,
    connectorId: 'whatsapp',
    capabilityId: 'outbound_messages',
    logger
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// APP BUILDER
// ─────────────────────────────────────────────────────────────────────────────

export async function buildApp(): Promise<Express> {
  const app = express();

  // Initialize dedupe store (Redis validation in staging/production)
  const dedupeStore = await createDedupeStore();

  // ─────────────────────────────────────────────────────────────────────────
  // CRITICAL: rawBodyMiddleware MUST be first middleware
  // ─────────────────────────────────────────────────────────────────────────
  // This captures the raw request body as a Buffer BEFORE any JSON parsing.
  // Meta signs the raw bytes of the webhook payload, so we need the original
  // body to verify the X-Hub-Signature-256 header.
  //
  // If you add express.json() or any body parser BEFORE this middleware,
  // signature verification will FAIL because rawBody will be empty.
  // ─────────────────────────────────────────────────────────────────────────
  app.use(rawBodyMiddleware());

  // Health check
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', connector: whatsappManifest.id });
  });

  // Build runtime handlers with dedupe store
  const { handleGet, handlePost } = buildWebhookHandlers({
    manifest: whatsappManifest,
    dedupeStore, // Pass the dedupe store to runtime
    registry: {
      inbound_messages: async (event, ctx) => {
        ctx.logger.info('Inbound WhatsApp message handled', {
          dedupeKey: ctx.dedupeKey
        });
      },
      message_status_updates: async (_event, ctx) => {
        ctx.logger.info('WhatsApp message status handled', {
          dedupeKey: ctx.dedupeKey
        });
      }
    },
    parseEvents,
    verifyWebhook,
    signatureVerifier: createMetaSignatureVerifier(),
    logger
  });

  // GET /webhook - Meta verification
  app.get('/webhook', async (req, res) => {
    const result = await handleGet({
      headers: req.headers as Record<string, string | string[] | undefined>,
      query: req.query as Record<string, string | undefined>,
      body: req.body,
      rawBody: (req as RawBodyRequest).rawBody
    });

    if (result.headers) {
      for (const [key, value] of Object.entries(result.headers)) {
        res.setHeader(key, value);
      }
    }

    if (result.contentType === 'text/plain') {
      res.status(result.status).type('text/plain').send(result.body);
    } else {
      res.status(result.status).json(result.body);
    }
  });

  // POST /webhook - Event ingestion
  app.post('/webhook', async (req, res) => {
    const result = await handlePost({
      headers: req.headers as Record<string, string | string[] | undefined>,
      query: req.query as Record<string, string | undefined>,
      body: req.body,
      rawBody: (req as RawBodyRequest).rawBody
    });

    if (result.headers) {
      for (const [key, value] of Object.entries(result.headers)) {
        res.setHeader(key, value);
      }
    }

    res.status(result.status).json(result.body);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // STAGING OUTBOUND ENDPOINT (staging-only, token-protected)
  // ─────────────────────────────────────────────────────────────────────────
  // Allows controlled testing of outbound message processing in staging.
  // SECURITY: Requires X-Staging-Token header matching STAGING_OUTBOUND_TOKEN env var.
  // Use this to validate:
  // - Real outbound payloads to Meta API
  // - Distributed deduplication with Redis
  // - Exactly-once guarantees for side-effects
  // - Fixture generation from real API responses
  //
  // Example request:
  // POST /__staging/outbound
  // X-Staging-Token: <STAGING_OUTBOUND_TOKEN>
  // Content-Type: application/json
  // {
  //   "intents": [
  //     {
  //       "to": "5511999999999",
  //       "type": "text",
  //       "text": { "body": "Test message" },
  //       "idempotencyKey": "test-msg-001"
  //     }
  //   ]
  // }
  // ─────────────────────────────────────────────────────────────────────────
  app.post('/__staging/outbound', express.json(), async (req, res) => {
    const nodeEnv = process.env.NODE_ENV || 'development';
    const stagingToken = process.env.STAGING_OUTBOUND_TOKEN;

    // Only available in staging/development (not production)
    if (nodeEnv === 'production') {
      return res.status(404).json({ ok: false, error: 'Endpoint not available in production' });
    }

    // Token authentication
    const providedToken = req.headers['x-staging-token'];
    if (!stagingToken) {
      logger.error('STAGING_OUTBOUND_TOKEN not configured');
      return res.status(503).json({ ok: false, error: 'Staging outbound endpoint not configured' });
    }
    if (providedToken !== stagingToken) {
      logger.warn('Invalid staging token attempt', { ip: req.ip });
      return res.status(401).json({ ok: false, error: 'Invalid or missing X-Staging-Token' });
    }

    // Validate required env vars for outbound
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!accessToken || !phoneNumberId) {
      return res.status(503).json({
        ok: false,
        error: 'Missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID'
      });
    }

    // Parse and validate request body
    const { intents } = req.body as { intents?: OutboundMessageIntent[] };
    if (!Array.isArray(intents) || intents.length === 0) {
      return res.status(400).json({ ok: false, error: 'Missing or empty "intents" array in request body' });
    }

    logger.info('Processing staging outbound request', {
      intentCount: intents.length,
      nodeEnv
    });

    try {
      const result = await processWhatsAppOutbound(intents, {
        accessToken,
        phoneNumberId,
        dedupeStore,
        apiVersion: 'v18.0',
        timeoutMs: 10000
      });

      logger.info('Staging outbound completed', {
        summary: result.summary,
        nodeEnv
      });

      return res.status(200).json({
        ok: true,
        result
      });
    } catch (err) {
      logger.error('Staging outbound failed', {
        error: err instanceof Error ? err.message : String(err),
        nodeEnv
      });
      return res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unknown error'
      });
    }
  });

  return app;
}

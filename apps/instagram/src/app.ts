import express, { type Express } from 'express';
import { Redis } from 'ioredis';

import { rawBodyMiddleware, type RawBodyRequest } from '@connectors/adapter-express';
import { createLogger } from '@connectors/core-logging';
import { verifyHmacSha256 } from '@connectors/core-signature';
import {
  parseInstagramRuntimeRequest,
  processInstagramOutbound,
  type InstagramOutboundBatchOptions
} from '@connectors/core-meta-instagram';
import type { InstagramInboundMessageEvent, InstagramOutboundMessageIntent } from '@connectors/core-messaging';
import {
  buildWebhookHandlers,
  type CapabilityHandler,
  type RuntimeRequest,
  type SignatureVerifier,
  type WebhookVerifyHandler,
  InMemoryDedupeStore,
  RedisDedupeStore,
  type DedupeStore
} from '@connectors/core-runtime';

import { instagramManifest } from './manifest.js';

// ─────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────

const logger = createLogger({ service: 'instagram-app' });
const DEFAULT_API_VERSION = 'v19.0';

// ─────────────────────────────────────────────────────────────────────────────
// DEDUPE STORE FACTORY
// ─────────────────────────────────────────────────────────────────────────────

async function createDedupeStore(): Promise<DedupeStore> {
  const redisUrl = process.env.REDIS_URL;
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const isNonDev = nodeEnv === 'production' || nodeEnv === 'staging';

  if (isNonDev && !redisUrl) {
    const message = `REDIS_URL is required in ${nodeEnv} for distributed dedupe`;
    logger.error(message, { nodeEnv });
    throw new Error(message);
  }

  if (redisUrl) {
    const useTls = redisUrl.startsWith('rediss://');
    logger.info('Initializing Redis dedupe store', { nodeEnv, redisTls: useTls });

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

    if (isNonDev) {
      const timeoutMs = 5000;
      try {
        await Promise.race([
          redis.connect(),
          new Promise((_, reject) => setTimeout(() => reject(new Error(`Redis connect timeout after ${timeoutMs}ms`)), timeoutMs))
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

    const redisClientAdapter = {
      set: async (key: string, value: string, mode: 'NX', flag: 'PX', ttlMs: number): Promise<string | null> => {
        return redis.set(key, value, flag, ttlMs, mode);
      },
      exists: async (key: string): Promise<number> => redis.exists(key)
    };

    return new RedisDedupeStore({
      client: redisClientAdapter,
      keyPrefix: 'instagram:dedupe:',
      failMode: isNonDev ? 'closed' : 'open',
      onError: (error, context) => {
        logger.error('Redis dedupe operation failed', {
          error: error.message,
          operation: context.operation
        });
      }
    });
  }

  logger.warn('REDIS_URL not configured - using InMemoryDedupeStore', {
    warning: 'Only suitable for local/testing',
    nodeEnv
  });
  return new InMemoryDedupeStore();
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGNATURE VERIFIER
// ─────────────────────────────────────────────────────────────────────────────

function createMetaSignatureVerifier(): SignatureVerifier {
  const secret = process.env.INSTAGRAM_WEBHOOK_SECRET;

  return {
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
  const verifyToken = process.env.INSTAGRAM_VERIFY_TOKEN;

  if (!verifyToken) {
    logger.error('INSTAGRAM_VERIFY_TOKEN not configured');
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
// EVENT PARSER (REAL IG DM)
// ─────────────────────────────────────────────────────────────────────────────

const parseEvents = (request: RuntimeRequest) => parseInstagramRuntimeRequest(request);

// ─────────────────────────────────────────────────────────────────────────────
// APP BUILDER
// ─────────────────────────────────────────────────────────────────────────────

export async function buildApp(): Promise<Express> {
  const app = express();
  const dedupeStore = await createDedupeStore();

  const inboundMessagesHandler: CapabilityHandler = async (event, ctx) => {
    const payload = event as InstagramInboundMessageEvent;
    ctx.logger.info('Received Instagram DM', {
      messageId: payload.messageId,
      from: payload.from,
      type: payload.payload.type
    });
  };

  // Capture raw body for signature verification
  app.use(rawBodyMiddleware());

  // Health check
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', connector: instagramManifest.id });
  });

  // Build runtime handlers
  const { handleGet, handlePost } = buildWebhookHandlers({
    manifest: instagramManifest,
    registry: {
      inbound_messages: inboundMessagesHandler
    },
    parseEvents,
    verifyWebhook,
    signatureVerifier: createMetaSignatureVerifier(),
    dedupeStore,
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

  // STAGING OUTBOUND (token-protected)
  app.post('/__staging/outbound', express.json(), async (req, res) => {
    const nodeEnv = process.env.NODE_ENV ?? 'development';
    const stagingToken = process.env.STAGING_OUTBOUND_TOKEN;

    if (nodeEnv === 'production') {
      return res.status(404).json({ ok: false, error: 'Endpoint not available in production' });
    }

    if (!stagingToken) {
      logger.error('STAGING_OUTBOUND_TOKEN not configured');
      return res.status(503).json({ ok: false, error: 'Staging outbound endpoint not configured' });
    }

    const providedToken = req.headers['x-staging-token'];
    if (providedToken !== stagingToken) {
      logger.warn('Invalid staging token attempt', { ip: req.ip });
      return res.status(401).json({ ok: false, error: 'Invalid or missing X-Staging-Token' });
    }

    const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
    const instagramBusinessAccountId =
      process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID ?? process.env.INSTAGRAM_PAGE_ID;

    if (!accessToken || !instagramBusinessAccountId) {
      return res.status(503).json({
        ok: false,
        error: 'Missing INSTAGRAM_ACCESS_TOKEN or INSTAGRAM_BUSINESS_ACCOUNT_ID'
      });
    }

    const { intents } = req.body as { intents?: InstagramOutboundMessageIntent[] };
    if (!Array.isArray(intents) || intents.length === 0) {
      return res.status(400).json({ ok: false, error: 'Missing or empty "intents" array in request body' });
    }

    logger.info('Processing Instagram staging outbound', { intentCount: intents.length, nodeEnv });

    try {
      const result = await processInstagramOutbound(intents, {
        accessToken,
        instagramBusinessAccountId,
        apiVersion: DEFAULT_API_VERSION,
        dedupeStore,
        uploadMedia: 'when_missing',
        timeoutMs: 10000
      } satisfies InstagramOutboundBatchOptions);

      logger.info('Staging outbound completed', { summary: result.summary, nodeEnv });
      return res.status(200).json({ ok: true, result });
    } catch (err) {
      logger.error('Staging outbound failed', {
        error: err instanceof Error ? err.message : String(err),
        nodeEnv
      });
      return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  return app;
}

import express, { type Express } from 'express';

import { createLogger } from '@connectors/core-logging';
import { rawBodyMiddleware, type RawBodyRequest } from '@connectors/adapter-express';
import { verifyHmacSha256 } from '@connectors/core-signature';
import { parseInstagramRuntimeRequest, type InstagramMessageNormalized } from '@connectors/core-meta-instagram';
import {
  buildWebhookHandlers,
  type CapabilityHandler,
  type RuntimeRequest,
  type SignatureVerifier,
  type WebhookVerifyHandler
} from '@connectors/core-runtime';

import { instagramManifest } from './manifest.js';

// ─────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────

const logger = createLogger({ service: 'instagram-app' });

// ─────────────────────────────────────────────────────────────────────────────
// SIGNATURE VERIFIER
// ─────────────────────────────────────────────────────────────────────────────

function createMetaSignatureVerifier(): SignatureVerifier {
  const secret = process.env.INSTAGRAM_WEBHOOK_SECRET;

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

export function buildApp(): Express {
  const app = express();
  const inboundMessagesHandler: CapabilityHandler = async (event, ctx) => {
    const payload = event as InstagramMessageNormalized;
    ctx.logger.info('Received Instagram DM', {
      mid: payload.mid,
      sender: payload.senderId
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

  return app;
}

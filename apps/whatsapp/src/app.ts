import express, { type Express } from 'express';

import { createLogger } from '@connectors/core-logging';
import { rawBodyMiddleware, type RawBodyRequest } from '@connectors/adapter-express';
import { verifyHmacSha256 } from '@connectors/core-signature';
import {
  buildWebhookHandlers,
  type ParsedEvent,
  type RuntimeRequest,
  type SignatureVerifier,
  type WebhookVerifyHandler
} from '@connectors/core-runtime';
import { capability, type ConnectorManifest } from '@connectors/core-connectors';
import { parseWhatsAppRuntimeRequest } from '@connectors/core-meta-whatsapp';

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
    capability('outbound_messages', 'planned', 'Send messages via Graph API (not implemented yet)'),
    capability('webhook_verification', 'active', 'Meta webhook verification endpoint')
  ],
  webhookPath: '/webhook',
  healthPath: '/health',
  requiredEnvVars: ['WHATSAPP_VERIFY_TOKEN'],
  optionalEnvVars: ['WHATSAPP_WEBHOOK_SECRET']
};

// ─────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────

const logger = createLogger({ service: 'whatsapp-app' });

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
// APP BUILDER
// ─────────────────────────────────────────────────────────────────────────────

export function buildApp(): Express {
  const app = express();

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

  // Build runtime handlers
  const { handleGet, handlePost } = buildWebhookHandlers({
    manifest: whatsappManifest,
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

  return app;
}

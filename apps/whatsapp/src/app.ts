import express, { type Express, type RequestHandler } from 'express';

import { parseEventEnvelope } from '@connectors/core-events';
import { createLogger } from '@connectors/core-logging';
import { assertTenantId } from '@connectors/core-tenant';
import { createExpressWebhookHandler, rawBodyMiddleware, type RawBodyRequest } from '@connectors/adapter-express';
import { createWebhookProcessor } from '@connectors/core-webhooks';
import { verifyHmacSha256 } from '@connectors/core-signature';

const logger = createLogger({ service: 'whatsapp-app' });

function generateCorrelationId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Express request with correlationId attached.
 */
export interface CorrelatedRequest extends RawBodyRequest {
  correlationId?: string;
}

/**
 * Middleware to validate webhook signature when WHATSAPP_WEBHOOK_SECRET is set.
 * Also extracts or generates correlationId and attaches it to the request.
 * If secret is not set, validation is skipped and logged.
 */
function createSignatureValidationMiddleware(): RequestHandler {
  return (req, res, next) => {
    const secret = process.env.WHATSAPP_WEBHOOK_SECRET;

    // Extract correlationId from header or generate a new one
    const headerCorrelationId = req.headers['x-correlation-id'];
    const correlationId =
      typeof headerCorrelationId === 'string'
        ? headerCorrelationId
        : Array.isArray(headerCorrelationId)
          ? headerCorrelationId[0]
          : generateCorrelationId();

    // Attach to request for downstream handlers
    (req as CorrelatedRequest).correlationId = correlationId;

    // Always set response header
    res.setHeader('x-correlation-id', correlationId);

    if (!secret) {
      // No secret configured - skip validation but log it
      logger.info('Signature validation skipped', {
        signatureValidation: 'skipped',
        correlationId
      });
      return next();
    }

    const rawReq = req as RawBodyRequest;
    const signatureHeader = req.headers['x-hub-signature-256'] as string | undefined;

    const result = verifyHmacSha256({
      secret,
      rawBody: rawReq.rawBody ?? '',
      signatureHeader: signatureHeader ?? ''
    });

    if (!result.valid) {
      logger.warn('Webhook signature validation failed', {
        code: result.code,
        correlationId
      });

      res.status(401).json({
        ok: false,
        code: 'UNAUTHORIZED',
        message: 'Invalid signature',
        correlationId
      });
      return;
    }

    next();
  };
}

export function buildApp(): Express {
  const app = express();

  // Use rawBodyMiddleware which captures raw body AND parses JSON
  app.use(rawBodyMiddleware());

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  /**
   * GET /webhook - Meta/WhatsApp webhook verification endpoint
   * https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests
   */
  app.get('/webhook', (req, res) => {
    const correlationId = generateCorrelationId();
    const mode = req.query['hub.mode'] as string | undefined;
    const token = req.query['hub.verify_token'] as string | undefined;
    const challenge = req.query['hub.challenge'] as string | undefined;

    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

    // If WHATSAPP_VERIFY_TOKEN is not configured, return 503
    if (!verifyToken) {
      logger.error('WHATSAPP_VERIFY_TOKEN not configured', { correlationId });
      res.setHeader('x-correlation-id', correlationId);
      res.status(503).json({
        ok: false,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Webhook verification not configured',
        correlationId
      });
      return;
    }

    // Validate the verification request
    if (mode === 'subscribe' && token === verifyToken) {
      logger.info('Webhook verification successful', { correlationId });
      res.setHeader('x-correlation-id', correlationId);
      res.status(200).type('text/plain').send(challenge ?? '');
      return;
    }

    // Invalid verification request
    logger.warn('Webhook verification failed', {
      correlationId,
      mode,
      tokenMatch: token === verifyToken
    });
    res.setHeader('x-correlation-id', correlationId);
    res.status(403).json({
      ok: false,
      code: 'FORBIDDEN',
      message: 'Invalid verify token',
      correlationId
    });
  });

  const processor = createWebhookProcessor({
    serviceName: 'whatsapp-app',
    parseEvent: (input) => {
      const envelope = parseEventEnvelope(input.body);
      assertTenantId(envelope.tenantId);
      return envelope;
    },
    onEvent: async (event, ctx) => {
      ctx.logger.info('Received webhook event', {
        dedupeKey: event.dedupeKey
      });
    },
    logger
  });

  app.post(
    '/webhook',
    createSignatureValidationMiddleware(),
    createExpressWebhookHandler(processor)
  );

  return app;
}

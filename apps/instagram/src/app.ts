import express, { type Express, type RequestHandler } from 'express';

import { parseEventEnvelope } from '@connectors/core-events';
import { createLogger } from '@connectors/core-logging';
import { assertTenantId } from '@connectors/core-tenant';
import { createExpressWebhookHandler, rawBodyMiddleware, type RawBodyRequest } from '@connectors/adapter-express';
import { createWebhookProcessor } from '@connectors/core-webhooks';
import { verifyHmacSha256 } from '@connectors/core-signature';

import { instagramManifest } from './manifest.js';

const logger = createLogger({ service: 'instagram-app' });

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
 * Middleware to extract or generate correlationId.
 * Attaches to req.correlationId and sets x-correlation-id response header.
 */
function correlationIdMiddleware(): RequestHandler {
  return (req, res, next) => {
    const headerCorrelationId = req.headers['x-correlation-id'];
    const correlationId =
      typeof headerCorrelationId === 'string'
        ? headerCorrelationId
        : Array.isArray(headerCorrelationId)
          ? headerCorrelationId[0]
          : generateCorrelationId();

    (req as CorrelatedRequest).correlationId = correlationId;
    res.setHeader('x-correlation-id', correlationId);
    next();
  };
}

/**
 * Middleware to validate webhook signature when INSTAGRAM_WEBHOOK_SECRET is set.
 * Requires correlationIdMiddleware to run first.
 * If secret is not set, validation is skipped and logged.
 */
function signatureValidationMiddleware(): RequestHandler {
  return (req, res, next) => {
    const secret = process.env.INSTAGRAM_WEBHOOK_SECRET;
    const correlationId = (req as CorrelatedRequest).correlationId!;

    if (!secret) {
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
    res.status(200).json({ status: 'ok', connector: instagramManifest.id });
  });

  /**
   * GET /webhook - Meta/Instagram webhook verification endpoint
   * https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests
   */
  app.get('/webhook', (req, res) => {
    const correlationId = generateCorrelationId();
    const mode = req.query['hub.mode'] as string | undefined;
    const token = req.query['hub.verify_token'] as string | undefined;
    const challenge = req.query['hub.challenge'] as string | undefined;

    res.setHeader('x-correlation-id', correlationId);
    const verifyToken = process.env.INSTAGRAM_VERIFY_TOKEN;

    // If INSTAGRAM_VERIFY_TOKEN is not configured, return 503
    if (!verifyToken) {
      logger.error('INSTAGRAM_VERIFY_TOKEN not configured', { correlationId });
      res.status(503).json({
        ok: false,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Webhook verification not configured',
        correlationId
      });
      return;
    }

    // Validate hub.mode first
    if (mode !== 'subscribe') {
      logger.warn('Webhook verification failed: invalid hub.mode', { correlationId, mode });
      res.status(403).json({
        ok: false,
        code: 'FORBIDDEN',
        message: 'Invalid hub.mode',
        correlationId
      });
      return;
    }

    // Validate verify token
    if (token !== verifyToken) {
      logger.warn('Webhook verification failed: invalid verify token', { correlationId });
      res.status(403).json({
        ok: false,
        code: 'FORBIDDEN',
        message: 'Invalid verify token',
        correlationId
      });
      return;
    }

    // Success
    logger.info('Webhook verification successful', { correlationId });
    res.status(200).type('text/plain').send(challenge ?? '');
  });

  const processor = createWebhookProcessor({
    serviceName: 'instagram-app',
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
    correlationIdMiddleware(),
    signatureValidationMiddleware(),
    createExpressWebhookHandler(processor)
  );

  return app;
}

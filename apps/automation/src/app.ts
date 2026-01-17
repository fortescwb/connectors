import express, { type Express } from 'express';

import { createLogger } from '@connectors/core-logging';
import { rawBodyMiddleware, type RawBodyRequest } from '@connectors/adapter-express';
import {
  buildWebhookHandlers,
  type RuntimeRequest,
  type ParsedEvent,
  type WebhookVerifyHandler
} from '@connectors/core-runtime';

import { automationManifest } from './manifest.js';

// ─────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────

const logger = createLogger({ service: 'automation-app' });

// ─────────────────────────────────────────────────────────────────────────────
// WEBHOOK VERIFY HANDLER (GET)
// ─────────────────────────────────────────────────────────────────────────────

// TODO: Implement real webhook verification for the target iPaaS provider
// Different providers (Zapier, Make, n8n) have different verification mechanisms
const verifyWebhook: WebhookVerifyHandler = (_query) => {
  logger.warn('Webhook verification not implemented for automation connector');
  return {
    success: false,
    errorCode: 'SERVICE_UNAVAILABLE',
    errorMessage: 'Automation webhook verification not yet implemented'
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// EVENT PARSER
// ─────────────────────────────────────────────────────────────────────────────

// TODO: Implement real event parsing for the target iPaaS provider
// This should parse incoming webhook payloads into AutomationTriggerEvent structures
function parseEvent(_request: RuntimeRequest): ParsedEvent {
  // Stub: This will fail validation until real parsing is implemented
  throw new Error(
    'Automation event parsing not yet implemented. ' +
    'Implement parseEvent() for the target iPaaS provider.'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// APP BUILDER
// ─────────────────────────────────────────────────────────────────────────────

export function buildApp(): Express {
  const app = express();

  // Capture raw body for potential signature verification
  app.use(rawBodyMiddleware());

  // Health check
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', connector: automationManifest.id });
  });

  // Build runtime handlers
  const { handleGet, handlePost } = buildWebhookHandlers({
    manifest: automationManifest,
    registry: {
      // TODO: Register handlers when capabilities are implemented
      // automation_trigger: async (event, ctx) => { ... },
      // automation_subscribe: async (event, ctx) => { ... },
    },
    parseEvent,
    verifyWebhook,
    // TODO: Add signature verification when implementing real provider
    // signatureVerifier: createAutomationSignatureVerifier(),
    logger
  });

  // GET /webhook - Provider verification (when implemented)
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

  // POST /webhook - Event ingestion (when implemented)
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

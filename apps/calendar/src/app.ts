import express, { type Express } from 'express';

import { createLogger } from '@connectors/core-logging';
import { rawBodyMiddleware, type RawBodyRequest } from '@connectors/adapter-express';
import {
  buildWebhookHandlers,
  type RuntimeRequest,
  type ParsedEvent,
  type WebhookVerifyHandler
} from '@connectors/core-runtime';

import { calendarManifest } from './manifest.js';

// ─────────────────────────────────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────────────────────────────────

const logger = createLogger({ service: 'calendar-app' });

// ─────────────────────────────────────────────────────────────────────────────
// WEBHOOK VERIFY HANDLER (GET)
// ─────────────────────────────────────────────────────────────────────────────

// TODO: Implement real webhook verification for the target calendar provider
// Different providers (Google, Apple, Microsoft) have different verification mechanisms
const verifyWebhook: WebhookVerifyHandler = (_query) => {
  logger.warn('Webhook verification not implemented for calendar connector');
  return {
    success: false,
    errorCode: 'SERVICE_UNAVAILABLE',
    errorMessage: 'Calendar webhook verification not yet implemented'
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// EVENT PARSER
// ─────────────────────────────────────────────────────────────────────────────

// TODO: Implement real event parsing for the target calendar provider
// This should parse incoming webhook payloads into normalized CalendarEvent structures
function parseEvent(_request: RuntimeRequest): ParsedEvent {
  // Stub: This will fail validation until real parsing is implemented
  throw new Error(
    'Calendar event parsing not yet implemented. ' +
    'Implement parseEvent() for the target calendar provider.'
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
    res.status(200).json({ status: 'ok', connector: calendarManifest.id });
  });

  // Build runtime handlers
  const { handleGet, handlePost } = buildWebhookHandlers({
    manifest: calendarManifest,
    registry: {
      // TODO: Register handlers when capabilities are implemented
      // calendar_read_events: async (event, ctx) => { ... },
      // calendar_write_events: async (event, ctx) => { ... },
    },
    parseEvent,
    verifyWebhook,
    // TODO: Add signature verification when implementing real provider
    // signatureVerifier: createCalendarSignatureVerifier(),
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

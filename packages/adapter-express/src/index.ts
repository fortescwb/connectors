import type { RequestHandler } from 'express';
import express from 'express';

import {
  createWebhookProcessor,
  type WebhookOptions,
  type WebhookRequest,
  type WebhookResponse
} from '@connectors/core-webhooks';

/**
 * Express request with rawBody captured and optional correlationId.
 *
 * @deprecated Use core-runtime webhook handlers directly; removal planned for v1.0.0.
 */
export interface RawBodyRequest extends express.Request {
  rawBody?: Buffer;
  correlationId?: string;
}

/**
 * Middleware to capture raw body as Buffer before JSON parsing.
 * Must be used before express.json() for routes that need signature verification.
 *
 * @deprecated Use core-runtime with an app-local raw body capture; removal planned for v1.0.0.
 */
export function rawBodyMiddleware(): RequestHandler {
  return express.json({
    verify: (req: RawBodyRequest, _res, buf) => {
      req.rawBody = buf;
    }
  });
}

/**
 * @deprecated Use core-runtime webhook handlers directly; removal planned for v1.0.0.
 */
export function createExpressWebhookHandler(processor: ReturnType<typeof createWebhookProcessor>): RequestHandler {
  return async (req, res, _next) => {
    const rawReq = req as RawBodyRequest;

    // Build headers, ensuring correlationId from request is included
    const headers = { ...req.headers } as Record<string, string | string[] | undefined>;
    if (rawReq.correlationId && !headers['x-correlation-id']) {
      headers['x-correlation-id'] = rawReq.correlationId;
    }

    const input: WebhookRequest = {
      headers,
      body: req.body,
      rawBody: rawReq.rawBody
    };

    const result: WebhookResponse = await processor(input);

    // Set custom headers from processor response
    if (result.headers) {
      for (const [key, value] of Object.entries(result.headers)) {
        res.setHeader(key, value);
      }
    }

    res.status(result.status).json(result.body);
  };
}

/**
 * @deprecated Use core-runtime webhook handlers directly; removal planned for v1.0.0.
 */
export function createExpressWebhookHandlerFromOptions(options: WebhookOptions): RequestHandler {
  const processor = createWebhookProcessor(options);
  return createExpressWebhookHandler(processor);
}

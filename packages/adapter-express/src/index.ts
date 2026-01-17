import type { RequestHandler } from 'express';
import express from 'express';

import {
  createWebhookProcessor,
  type WebhookOptions,
  type WebhookRequest,
  type WebhookResponse
} from '@connectors/core-webhooks';

/**
 * Express request with rawBody captured.
 */
export interface RawBodyRequest extends express.Request {
  rawBody?: Buffer;
}

/**
 * Middleware to capture raw body as Buffer before JSON parsing.
 * Must be used before express.json() for routes that need signature verification.
 */
export function rawBodyMiddleware(): RequestHandler {
  return express.json({
    verify: (req: RawBodyRequest, _res, buf) => {
      req.rawBody = buf;
    }
  });
}

export function createExpressWebhookHandler(processor: ReturnType<typeof createWebhookProcessor>): RequestHandler {
  return async (req, res, _next) => {
    const input: WebhookRequest = {
      headers: req.headers as Record<string, string | string[] | undefined>,
      body: req.body,
      rawBody: (req as RawBodyRequest).rawBody
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

export function createExpressWebhookHandlerFromOptions(options: WebhookOptions): RequestHandler {
  const processor = createWebhookProcessor(options);
  return createExpressWebhookHandler(processor);
}

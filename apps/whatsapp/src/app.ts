import express, { type Express } from 'express';

import { parseEventEnvelope } from '@connectors/core-events';
import { createLogger } from '@connectors/core-logging';
import { assertTenantId } from '@connectors/core-tenant';
import { createExpressWebhookHandler } from '@connectors/adapter-express';
import { createWebhookProcessor } from '@connectors/core-webhooks';

const logger = createLogger({ service: 'whatsapp-app' });

export function buildApp(): Express {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
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

  app.post('/webhook', createExpressWebhookHandler(processor));

  return app;
}

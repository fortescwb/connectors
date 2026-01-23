import type { Express } from 'express';
import request, { type SuperTest, type Test } from 'supertest';

import { buildApp } from '../../src/app.js';
import { signMetaPayload } from './signature.js';

type PostOptions = {
  secret?: string;
  correlationId?: string;
  rawBody?: string;
  signature?: string;
};

export type TestClient = {
  app: Express;
  agent: SuperTest<Test>;
  getHealth: () => Test;
  getWebhook: (query: Record<string, string | undefined>) => Test;
  postWebhook: (payload: unknown, options?: PostOptions) => Test;
};

export async function createTestClient(defaults?: { secret?: string }): Promise<TestClient> {
  const app = await buildApp();
  const agent = request(app);

  const postWebhook = (payload: unknown, options?: PostOptions) => {
    const rawBody =
      typeof payload === 'string'
        ? payload
        : options?.rawBody
          ? options.rawBody
          : JSON.stringify(payload);

    let req = agent.post('/webhook').set('Content-Type', 'application/json');

    const secret = options?.secret ?? defaults?.secret;
    const signatureHeader = options?.signature ?? (secret ? signMetaPayload(secret, rawBody) : undefined);

    if (signatureHeader) {
      req = req.set('x-hub-signature-256', signatureHeader);
    }

    if (options?.correlationId) {
      req = req.set('x-correlation-id', options.correlationId);
    }

    return req.send(rawBody);
  };

  return {
    app,
    agent,
    getHealth: () => agent.get('/health'),
    getWebhook: (query) => agent.get('/webhook').query(query),
    postWebhook
  };
}

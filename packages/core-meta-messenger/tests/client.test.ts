import { describe, expect, it } from 'vitest';

import { createMessengerGraphClient } from '../src/index.js';

describe('createMessengerGraphClient', () => {
  it('reuses meta graph client with messenger context', async () => {
    const calls: Array<{ url: string }> = [];
    const client = createMessengerGraphClient({
      accessToken: 'token',
      apiVersion: 'v19.0',
      transport: async (url: RequestInfo | URL) => {
        calls.push({ url: String(url) });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
    });

    await client.post('123/messages', { hello: true });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('/v19.0/123/messages');
  });
});

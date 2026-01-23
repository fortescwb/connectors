import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildInstagramOutboundRequest } from '../src/index.js';
import { InstagramOutboundRequestSchema } from '../src/outbound/schemas.js';

const fixturesDir = path.join(__dirname, '..', 'fixtures', 'outbound');

function loadFixture<T>(name: string): T {
  const raw = readFileSync(path.join(fixturesDir, name), 'utf-8');
  return JSON.parse(raw) as T;
}

describe('buildInstagramOutboundRequest', () => {
  it('builds a POST request for text DM intent (relative url)', () => {
    const intent = loadFixture('dm_text.intent.json');
    const expected = loadFixture('dm_text.request.json');

    const request = buildInstagramOutboundRequest(intent, {
      instagramBusinessAccountId: '17890000000000001',
      apiVersion: 'v19.0'
    });

    expect(InstagramOutboundRequestSchema.parse(request)).toEqual(request);
    expect(request).toEqual(expected);
  });
});

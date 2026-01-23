import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildInstagramOutboundRequest } from '../src/outbound/buildOutboundRequest.js';
import { InstagramOutboundRequestSchema } from '../src/outbound/schemas.js';

const fixturesDir = path.join(__dirname, '..', 'fixtures', 'outbound');

function loadIntent(name: string) {
  const raw = readFileSync(path.join(fixturesDir, name), 'utf-8');
  return JSON.parse(raw);
}

describe('Instagram outbound builder with attachmentId override', () => {
  it('prefers provided attachmentId over mediaId/url for media payloads', () => {
    const intent = loadIntent('dm_image.intent.json');

    const request = buildInstagramOutboundRequest(intent, {
      instagramBusinessAccountId: '17890000000000001',
      apiVersion: 'v19.0',
      attachmentId: 'att_999'
    });

    const parsed = InstagramOutboundRequestSchema.parse(request);

    expect(parsed.body.message.attachment).toEqual({
      type: 'image',
      payload: { attachment_id: 'att_999' }
    });
    expect(parsed.body.message.text).toBe('optional caption');
    expect(parsed.url).toBe('v19.0/17890000000000001/messages');
  });
});

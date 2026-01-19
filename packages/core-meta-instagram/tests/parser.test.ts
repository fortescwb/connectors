import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { RuntimeRequest } from '@connectors/core-runtime';

import { parseInstagramRuntimeRequest, type InstagramMessageNormalized } from '../src/index.js';

function loadFixture(name: string): RuntimeRequest {
  const raw = readFileSync(join(__dirname, '..', 'fixtures', name), 'utf-8');
  return {
    headers: {},
    query: {},
    body: JSON.parse(raw)
  };
}

describe('parseInstagramRuntimeRequest', () => {
  it('parses single text message and builds dedupeKey', () => {
    const request = loadFixture('message_text.json');
    const events = parseInstagramRuntimeRequest(request);
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event.capabilityId).toBe('inbound_messages');
    expect(event.dedupeKey).toBe('instagram:17841400000000000:msg:m_igmsg_111');
    expect(event.payload.text).toBe('hello from ig dm');
  });

  it('parses media message and preserves attachments', () => {
    const request = loadFixture('message_media.json');
    const events = parseInstagramRuntimeRequest(request);
    expect(events).toHaveLength(1);
    const payload: InstagramMessageNormalized = events[0].payload;
    expect(payload.attachments?.[0]?.type).toBe('image');
    expect(payload.attachments?.[0]?.payload?.url).toContain('example.com/media/ig-image.jpg');
  });

  it('parses batch with multiple messaging items', () => {
    const request = loadFixture('batch_mixed.json');
    const events = parseInstagramRuntimeRequest(request);
    expect(events).toHaveLength(2);
    const dedupeKeys = events.map((e) => e.dedupeKey);
    expect(dedupeKeys).toContain('instagram:17841400000000000:msg:m_igmsg_batch_1');
    expect(dedupeKeys).toContain('instagram:17841400000000000:msg:m_igmsg_batch_2');
  });

  it('rejects invalid payload', () => {
    const request: RuntimeRequest = {
      headers: {},
      query: {},
      body: { object: 'instagram', entry: [{ id: 'bad', time: 'x' }] }
    };

    expect(() => parseInstagramRuntimeRequest(request)).toThrow();
  });
});

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildInstagramOutboundDmDedupeKey } from '../src/index.js';

const fixturesDir = path.join(__dirname, '..', 'fixtures', 'outbound');

function loadFixture<T>(name: string): T {
  const raw = readFileSync(path.join(fixturesDir, name), 'utf-8');
  return JSON.parse(raw) as T;
}

describe('Instagram outbound DM dedupeKey contract', () => {
  const intent = loadFixture<{ to: string; clientMessageId: string; payload: { text?: string } }>('dm_text.intent.json');
  const piiStrings = [intent.payload.text ?? ''];

  it('is deterministic for the same recipient + clientMessageId', () => {
    const key1 = buildInstagramOutboundDmDedupeKey(intent.to, intent.clientMessageId);
    const key2 = buildInstagramOutboundDmDedupeKey(intent.to, intent.clientMessageId);
    expect(key1).toBe('instagram:outbound:dm:17890000000000000:client-msg-ig-001');
    expect(key2).toBe(key1);
  });

  it('changes when clientMessageId changes', () => {
    const key1 = buildInstagramOutboundDmDedupeKey(intent.to, intent.clientMessageId);
    const key2 = buildInstagramOutboundDmDedupeKey(intent.to, 'client-msg-ig-999');
    expect(key1).not.toBe(key2);
  });

  it('does not leak text payload into dedupeKey', () => {
    const key = buildInstagramOutboundDmDedupeKey(intent.to, intent.clientMessageId);
    for (const pii of piiStrings) {
      if (pii) {
        expect(key.includes(pii)).toBe(false);
      }
    }
  });

  it.each([
    ['17890000000000000', 'client-msg-ig-001'],
    ['17890000000000000', 'client-msg-ig-002'],
    ['17890000000000001', 'client-msg-ig-001']
  ])('is stable across batch inputs (%s, %s)', (recipientId, clientMessageId) => {
    const key = buildInstagramOutboundDmDedupeKey(recipientId, clientMessageId);
    expect(key).toBe(`instagram:outbound:dm:${recipientId}:${clientMessageId}`);
  });
});

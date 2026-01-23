import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseInstagramRuntimeRequest } from '../src/index.js';

const fixturesDir = path.join(__dirname, '..', 'fixtures', 'inbound');

const piiStrings = ['hello from ig dm', '523456789012345']; // text + sender id

function loadFixture(name: string) {
  const raw = readFileSync(path.join(fixturesDir, name), 'utf-8');
  return {
    headers: {},
    query: {},
    body: JSON.parse(raw)
  };
}

function firstDedupeKey(fixtureName: string): string {
  const events = parseInstagramRuntimeRequest(loadFixture(fixtureName));
  expect(events.length).toBeGreaterThan(0);
  return events[0]!.dedupeKey;
}

describe('Instagram dedupeKey contract (inbound)', () => {
  it('is deterministic for the same payload', () => {
    const key1 = firstDedupeKey('text.json');
    const key2 = firstDedupeKey('text.json');
    expect(key1).toBe('instagram:17841400000000000:msg:m_igmsg_text_001');
    expect(key2).toBe(key1);
  });

  it('changes when message id changes', () => {
    const base = loadFixture('text.json');
    const mutated = JSON.parse(JSON.stringify(base));
    mutated.body.entry[0].messaging[0].message.mid = 'm_igmsg_text_999';

    const original = parseInstagramRuntimeRequest(base)[0]!.dedupeKey;
    const updated = parseInstagramRuntimeRequest(mutated)[0]!.dedupeKey;

    expect(original).not.toBe(updated);
    expect(updated).toBe('instagram:17841400000000000:msg:m_igmsg_text_999');
  });

  it('does not leak PII (text or sender id) into dedupeKey', () => {
    const key = firstDedupeKey('text.json');
    for (const pii of piiStrings) {
      expect(key.includes(pii)).toBe(false);
    }
  });

  it('produces distinct keys for different items in batch', () => {
    const events = parseInstagramRuntimeRequest(loadFixture('batch.json'));
    const keys = events.map((e) => e.dedupeKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

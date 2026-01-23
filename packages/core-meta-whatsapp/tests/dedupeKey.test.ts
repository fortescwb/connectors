import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseWhatsAppWebhook } from '../src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type FixtureCase = {
  type: string;
  file: string;
  expectedKey: string;
};

const fixtures: FixtureCase[] = [
  { type: 'text', file: 'text.json', expectedKey: 'whatsapp:PHONE_ID_001:msg:wamid.fake.text.001' },
  { type: 'audio', file: 'audio.json', expectedKey: 'whatsapp:PHONE_ID_001:msg:wamid.fake.audio.001' },
  { type: 'document', file: 'document.json', expectedKey: 'whatsapp:PHONE_ID_001:msg:wamid.fake.document.001' },
  { type: 'video', file: 'video.json', expectedKey: 'whatsapp:PHONE_ID_001:msg:wamid.fake.video.001' },
  { type: 'sticker', file: 'sticker.json', expectedKey: 'whatsapp:PHONE_ID_001:msg:wamid.fake.sticker.001' },
  { type: 'reaction', file: 'reaction.json', expectedKey: 'whatsapp:PHONE_ID_001:msg:wamid.fake.reaction.001' },
  { type: 'template', file: 'template.json', expectedKey: 'whatsapp:PHONE_ID_001:msg:wamid.fake.template.001' },
  { type: 'contact', file: 'contact.json', expectedKey: 'whatsapp:PHONE_ID_001:msg:wamid.fake.contact.001' },
  { type: 'location', file: 'location.json', expectedKey: 'whatsapp:PHONE_ID_001:msg:wamid.fake.location.001' }
];

const piiStrings = ['15550009999', '15551230001', 'Fixture', 'Sample inbound text message', 'john.doe@example.test'];

function loadFixture(name: string): unknown {
  const filePath = path.join(__dirname, '..', 'fixtures', 'dedupe', name);
  const contents = readFileSync(filePath, 'utf-8');
  return JSON.parse(contents);
}

function extractFirstDedupeKey(payload: unknown): string {
  const events = parseWhatsAppWebhook(payload);
  expect(events.length).toBeGreaterThan(0);
  return events[0]!.dedupeKey;
}

describe('WhatsApp dedupeKey contract (inbound messages)', () => {
  describe.each(fixtures)('type: $type', ({ file, expectedKey }) => {
    it('is deterministic for the same payload (phoneNumberId + wamid only)', () => {
      const payload = loadFixture(file);

      const first = extractFirstDedupeKey(payload);
      const second = extractFirstDedupeKey(payload);

      expect(first).toBe(expectedKey);
      expect(second).toBe(expectedKey);
      expect(first.startsWith('whatsapp:')).toBe(true);
    });

    it('does not leak PII or message contents into the key', () => {
      const payload = loadFixture(file);
      const key = extractFirstDedupeKey(payload);

      for (const pii of piiStrings) {
        expect(key.includes(pii)).toBe(false);
      }
    });
  });

  it('keeps the same dedupeKey when non-deduping fields change (text body)', () => {
    const payload = loadFixture('text.json') as Record<string, any>;
    const mutated = JSON.parse(JSON.stringify(payload));

    mutated.entry[0].changes[0].value.messages[0].text.body = 'Body changed but id is stable';

    const originalKey = extractFirstDedupeKey(payload);
    const mutatedKey = extractFirstDedupeKey(mutated);

    expect(originalKey).toBe(mutatedKey);
  });

  it('produces different keys for different message ids (text vs audio)', () => {
    const textKey = extractFirstDedupeKey(loadFixture('text.json'));
    const audioKey = extractFirstDedupeKey(loadFixture('audio.json'));

    expect(textKey).not.toBe(audioKey);
  });

  it('changes dedupeKey when wamid changes (distinct message)', () => {
    const payload = loadFixture('text.json') as Record<string, any>;
    const mutated = JSON.parse(JSON.stringify(payload));
    mutated.entry[0].changes[0].value.messages[0].id = 'wamid.fake.text.002';

    const originalKey = extractFirstDedupeKey(payload);
    const mutatedKey = extractFirstDedupeKey(mutated);

    expect(originalKey).not.toBe(mutatedKey);
    expect(mutatedKey).toBe('whatsapp:PHONE_ID_001:msg:wamid.fake.text.002');
  });
});

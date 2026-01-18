import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ValidationError } from '@connectors/core-validation';

import { parseWhatsAppWebhook } from '../src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadFixture(name: string): unknown {
  const filePath = path.join(__dirname, '..', 'fixtures', name);
  const contents = readFileSync(filePath, 'utf-8');
  return JSON.parse(contents);
}

describe('parseWhatsAppWebhook', () => {
  it('parses multi-item webhook with messages and statuses', () => {
    const payload = loadFixture('message_batch.json');

    const events = parseWhatsAppWebhook(payload);

    expect(events).toHaveLength(3);

    const messageEvent = events.find((e) => e.capabilityId === 'inbound_messages');
    const statusEvent = events.find((e) => e.capabilityId === 'message_status_updates');

    expect(messageEvent?.dedupeKey).toBe('whatsapp:441234567890:msg:wamid.MSG1.111111');
    expect(statusEvent?.dedupeKey).toBe('whatsapp:441234567890:status:wamid.MSG1.111111:delivered');

    // Ensure normalized payload keeps important fields
    const messagePayload = messageEvent?.payload as { metadata: { phoneNumberId: string }; message: { textBody?: string } };
    expect(messagePayload.metadata.phoneNumberId).toBe('441234567890');
    expect(messagePayload.message.textBody).toBe('Hello from WhatsApp');
  });

  it('builds dedupeKey deterministically for duplicates', () => {
    const payload = loadFixture('message_duplicate.json');

    const events = parseWhatsAppWebhook(payload);

    expect(events).toHaveLength(1);
    expect(events[0]?.dedupeKey).toBe('whatsapp:441234567890:msg:wamid.DUPLICATE.123');
  });

  it('throws ValidationError on malformed payload', () => {
    const payload = loadFixture('invalid_missing_metadata.json');

    expect(() => parseWhatsAppWebhook(payload)).toThrow(ValidationError);
  });

  describe('status type parsing', () => {
    it('parses status_sent fixture correctly', () => {
      const payload = loadFixture('status_sent.json');

      const events = parseWhatsAppWebhook(payload);

      expect(events).toHaveLength(1);
      expect(events[0]?.capabilityId).toBe('message_status_updates');
      expect(events[0]?.dedupeKey).toBe('whatsapp:441234567890:status:wamid.STATUS.SENT.111:sent');

      const statusPayload = events[0]?.payload as { status: { status: string } };
      expect(statusPayload.status.status).toBe('sent');
    });

    it('parses status_read fixture correctly', () => {
      const payload = loadFixture('status_read.json');

      const events = parseWhatsAppWebhook(payload);

      expect(events).toHaveLength(1);
      expect(events[0]?.capabilityId).toBe('message_status_updates');
      expect(events[0]?.dedupeKey).toBe('whatsapp:441234567890:status:wamid.STATUS.READ.111:read');

      const statusPayload = events[0]?.payload as { status: { status: string } };
      expect(statusPayload.status.status).toBe('read');
    });

    it('parses status_failed fixture with error details', () => {
      const payload = loadFixture('status_failed.json');

      const events = parseWhatsAppWebhook(payload);

      expect(events).toHaveLength(1);
      expect(events[0]?.capabilityId).toBe('message_status_updates');
      expect(events[0]?.dedupeKey).toBe('whatsapp:441234567890:status:wamid.STATUS.FAILED.111:failed');

      const statusPayload = events[0]?.payload as { status: { status: string; raw: { errors?: unknown[] } } };
      expect(statusPayload.status.status).toBe('failed');
      expect(statusPayload.status.raw.errors).toHaveLength(1);
    });

    it('parses delivered status from batch fixture', () => {
      const payload = loadFixture('message_batch.json');

      const events = parseWhatsAppWebhook(payload);
      const deliveredEvent = events.find(
        (e) => e.capabilityId === 'message_status_updates' && e.dedupeKey.includes(':delivered')
      );

      expect(deliveredEvent).toBeDefined();
      expect(deliveredEvent?.dedupeKey).toBe('whatsapp:441234567890:status:wamid.MSG1.111111:delivered');
    });
  });
});

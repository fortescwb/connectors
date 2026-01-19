import type { ParsedEvent } from '@connectors/core-runtime';
import type { InstagramWebhookBody, InstagramMessageNormalized } from './index.js';

function buildDedupeKey(recipientId: string, mid: string): string {
  return `instagram:${recipientId}:msg:${mid}`;
}

export function parseInstagramWebhookPayload(body: InstagramWebhookBody): ParsedEvent<InstagramMessageNormalized>[] {
  const events: ParsedEvent<InstagramMessageNormalized>[] = [];

  for (const entry of body.entry) {
    for (const messaging of entry.messaging) {
      const mid = messaging.message.mid;
      const dedupeKey = buildDedupeKey(messaging.recipient.id, mid);

      events.push({
        capabilityId: 'inbound_messages',
        dedupeKey,
        connector: 'instagram',
        payload: {
          object: body.object,
          entryId: entry.id,
          senderId: messaging.sender.id,
          recipientId: messaging.recipient.id,
          timestamp: messaging.timestamp,
          mid,
          text: messaging.message.text,
          attachments: messaging.message.attachments,
          raw: messaging as Record<string, unknown>
        }
      });
    }
  }

  return events;
}

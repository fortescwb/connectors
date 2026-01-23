import type { z } from 'zod';

import { safeParseOrThrow } from '@connectors/core-validation';
import type { ParsedEvent, RuntimeRequest } from '@connectors/core-runtime';
import {
  InstagramInboundMessageEventSchema,
  type InstagramInboundMessageEvent,
  type InstagramInboundMessagePayload,
  buildInstagramInboundDedupeKey
} from '@connectors/core-messaging';

import {
  InstagramWebhookSchema,
  type InstagramWebhookBody,
  InstagramMessageSchema,
  InstagramMessagingSchema
} from './schemas.js';

function mapAttachmentToPayload(message: z.infer<typeof InstagramMessageSchema>): InstagramInboundMessagePayload {
  if (message.attachments && message.attachments.length > 0) {
    const attachment = message.attachments[0];
    const payload = attachment.payload ?? {};
    const base = {
      id: payload.id ?? payload.sticker_id,
      url: payload.url,
      mimeType: undefined as string | undefined
    };

    switch (attachment.type) {
      case 'image':
        return { type: 'image', ...base, caption: message.text };
      case 'video':
        return { type: 'video', ...base, caption: message.text };
      case 'audio':
      case 'voice':
        return { type: 'audio', ...base };
      case 'file':
      case 'document':
        return { type: 'document', ...base };
      default:
        if (message.text) {
          return { type: 'text', text: message.text };
        }
    }
  }

  if (message.text) {
    return { type: 'text', text: message.text };
  }

  throw new Error('Instagram message missing text and attachments');
}

function normalizeMessagingItem(
  messaging: z.infer<typeof InstagramMessagingSchema>
): ParsedEvent<InstagramInboundMessageEvent> {
  if (!messaging.message.mid) {
    throw new Error('Instagram message.mid is required for dedupe');
  }
  const messagePayload = mapAttachmentToPayload(messaging.message);
  const dedupeKey = buildInstagramInboundDedupeKey(messaging.recipient.id, messaging.message.mid);

  const normalized = InstagramInboundMessageEventSchema.parse({
    provider: 'instagram',
    channel: 'instagram_dm',
    from: messaging.sender.id,
    to: messaging.recipient.id,
    messageId: messaging.message.mid,
    timestamp: messaging.timestamp,
    payload: messagePayload,
    dedupeKey,
    raw: messaging as Record<string, unknown>
  });

  return {
    capabilityId: 'inbound_messages',
    connector: 'instagram',
    dedupeKey,
    payload: normalized
  };
}

/**
 * @internal Assumes payload already validated; prefer parseInstagramRuntimeRequest.
 * @deprecated Use parseInstagramRuntimeRequest instead.
 */
export function parseInstagramWebhookPayload(body: InstagramWebhookBody): ParsedEvent<InstagramInboundMessageEvent>[] {
  const events: ParsedEvent<InstagramInboundMessageEvent>[] = [];

  for (const entry of body.entry) {
    for (const messaging of entry.messaging) {
      try {
        events.push(normalizeMessagingItem(messaging));
      } catch {
        // Skip invalid messaging item to keep batch processing resilient
        continue;
      }
    }
  }

  return events;
}

/**
 * Parse Meta/Instagram webhook into ParsedEvent batch for inbound DMs.
 * Batch-safe: one ParsedEvent per messaging item.
 */
export function parseInstagramRuntimeRequest(request: RuntimeRequest): ParsedEvent<InstagramInboundMessageEvent>[] {
  const body = safeParseOrThrow(InstagramWebhookSchema, request.body, 'instagram-webhook');
  const parsed = parseInstagramWebhookPayload(body);
  return parsed.filter(Boolean);
}

import { safeParseOrThrow } from '@connectors/core-validation';
import type { ParsedEvent, RuntimeRequest } from '@connectors/core-runtime';
import {
  InstagramInboundMessageEventSchema,
  type InstagramInboundMessageEvent,
  type InstagramInboundMessagePayload,
  buildInstagramInboundDedupeKey
} from '@connectors/core-messaging';
import { z } from 'zod';

const InstagramAttachmentSchema = z.object({
  type: z.string(),
  payload: z
    .object({
      url: z.string().url().optional(),
      sticker_id: z.string().optional(),
      id: z.string().optional()
    })
    .optional()
});

const InstagramMessageSchema = z.object({
  mid: z.string(),
  text: z.string().optional(),
  attachments: z.array(InstagramAttachmentSchema).optional()
});

const InstagramMessagingSchema = z.object({
  sender: z.object({ id: z.string() }),
  recipient: z.object({ id: z.string() }),
  timestamp: z.number(),
  message: InstagramMessageSchema
});

const InstagramEntrySchema = z.object({
  id: z.string(),
  time: z.number(),
  messaging: z.array(InstagramMessagingSchema)
});

export const InstagramWebhookSchema = z.object({
  object: z.literal('instagram').or(z.literal('page')).optional(),
  entry: z.array(InstagramEntrySchema)
});

export type InstagramWebhookBody = z.infer<typeof InstagramWebhookSchema>;

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

export function parseInstagramWebhookPayload(body: InstagramWebhookBody): ParsedEvent<InstagramInboundMessageEvent>[] {
  const events: ParsedEvent<InstagramInboundMessageEvent>[] = [];

  for (const entry of body.entry) {
    for (const messaging of entry.messaging) {
      events.push(normalizeMessagingItem(messaging));
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
  return parseInstagramWebhookPayload(body);
}

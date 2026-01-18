import type { ParsedEvent, RuntimeRequest } from '@connectors/core-runtime';
import { safeParseOrThrow, ValidationError } from '@connectors/core-validation';
import { z } from 'zod';

import type {
  WhatsAppContact,
  WhatsAppMessage,
  WhatsAppMessageEventPayload,
  WhatsAppMetadata,
  WhatsAppStatus,
  WhatsAppStatusEventPayload
} from './types.js';

const metadataSchema = z.object({
  display_phone_number: z.string(),
  phone_number_id: z.string()
});

const messageSchema = z.object({
  id: z.string(),
  from: z.string().optional(),
  timestamp: z.string().optional(),
  type: z.string(),
  text: z
    .object({
      body: z.string()
    })
    .optional(),
  image: z
    .object({
      id: z.string().optional(),
      mime_type: z.string().optional(),
      sha256: z.string().optional(),
      caption: z.string().optional()
    })
    .optional(),
  document: z
    .object({
      id: z.string().optional(),
      mime_type: z.string().optional(),
      sha256: z.string().optional(),
      filename: z.string().optional()
    })
    .optional()
});

const statusSchema = z.object({
  id: z.string().optional(),
  status: z.string(),
  timestamp: z.string().optional(),
  recipient_id: z.string().optional(),
  conversation: z
    .object({
      id: z.string().optional(),
      expiration_timestamp: z.string().optional(),
      origin: z.object({ type: z.string().optional() }).partial().optional()
    })
    .optional(),
  pricing: z.record(z.any()).optional(),
  errors: z
    .array(
      z.object({
        code: z.number().optional(),
        title: z.string().optional(),
        message: z.string().optional(),
        error_data: z.record(z.any()).optional()
      })
    )
    .optional()
});

const changeValueSchema = z.object({
  messaging_product: z.literal('whatsapp'),
  metadata: metadataSchema,
  contacts: z
    .array(
      z.object({
        wa_id: z.string(),
        profile: z
          .object({
            name: z.string().optional()
          })
          .optional()
      })
    )
    .optional(),
  messages: z.array(messageSchema).optional(),
  statuses: z.array(statusSchema).optional()
});

const changeSchema = z.object({
  field: z.string(),
  value: changeValueSchema
});

const entrySchema = z.object({
  id: z.string(),
  changes: z.array(changeSchema)
});

const webhookSchema = z.object({
  object: z.string(),
  entry: z.array(entrySchema)
});

type WebhookPayload = z.infer<typeof webhookSchema>;

function toMetadata(input: z.infer<typeof metadataSchema>): WhatsAppMetadata {
  return {
    displayPhoneNumber: input.display_phone_number,
    phoneNumberId: input.phone_number_id
  };
}

function toContacts(input: NonNullable<z.infer<typeof changeValueSchema>['contacts']>): WhatsAppContact[] {
  return input.map((contact) => ({
    waId: contact.wa_id,
    name: contact.profile?.name
  }));
}

function toMessage(input: z.infer<typeof messageSchema>): WhatsAppMessage {
  return {
    id: input.id,
    from: input.from,
    timestamp: input.timestamp,
    type: input.type,
    textBody: input.text?.body,
    image: input.image
      ? {
          id: input.image.id,
          mimeType: input.image.mime_type,
          sha256: input.image.sha256,
          caption: input.image.caption
        }
      : undefined,
    document: input.document
      ? {
          id: input.document.id,
          mimeType: input.document.mime_type,
          sha256: input.document.sha256,
          filename: input.document.filename
        }
      : undefined,
    raw: input as Record<string, unknown>
  };
}

function toStatus(input: z.infer<typeof statusSchema>): WhatsAppStatus {
  return {
    id: input.id,
    status: input.status,
    timestamp: input.timestamp,
    recipientId: input.recipient_id,
    conversationId: input.conversation?.id,
    raw: input as Record<string, unknown>
  };
}

function buildMessageDedupeKey(phoneNumberId: string, messageId: string): string {
  return `whatsapp:${phoneNumberId}:msg:${messageId}`;
}

function buildStatusDedupeKey(phoneNumberId: string, statusIdOrMessageId: string, status: string): string {
  return `whatsapp:${phoneNumberId}:status:${statusIdOrMessageId}:${status}`;
}

function mapChangeToEvents(payload: WebhookPayload, entryId: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];

  for (const change of payload.entry.find((e) => e.id === entryId)?.changes ?? []) {
    const value = change.value;
    const metadata = toMetadata(value.metadata);
    const contacts = value.contacts ? toContacts(value.contacts) : undefined;

    for (const message of value.messages ?? []) {
      const normalizedMessage = toMessage(message);
      events.push({
        capabilityId: 'inbound_messages',
        dedupeKey: buildMessageDedupeKey(metadata.phoneNumberId, normalizedMessage.id),
        payload: {
          object: payload.object,
          metadata,
          contacts,
          message: normalizedMessage
        } satisfies WhatsAppMessageEventPayload
      });
    }

    for (const status of value.statuses ?? []) {
      const normalizedStatus = toStatus(status);
      const statusId = normalizedStatus.id ?? normalizedStatus.recipientId ?? 'unknown';
      events.push({
        capabilityId: 'message_status_updates',
        dedupeKey: buildStatusDedupeKey(metadata.phoneNumberId, statusId, normalizedStatus.status),
        payload: {
          object: payload.object,
          metadata,
          status: normalizedStatus
        } satisfies WhatsAppStatusEventPayload
      });
    }
  }

  return events;
}

/**
 * Parse a Meta WhatsApp webhook payload into runtime events.
 * Throws ValidationError when payload is invalid or no events are found.
 */
export function parseWhatsAppWebhook(body: unknown): ParsedEvent[] {
  const parsed = safeParseOrThrow(webhookSchema, body, 'whatsapp.webhook');
  const events: ParsedEvent[] = [];

  for (const entry of parsed.entry) {
    events.push(...mapChangeToEvents(parsed, entry.id));
  }

  if (events.length === 0) {
    throw new ValidationError('whatsapp.webhook: no messages or statuses in payload', [], 'whatsapp.webhook');
  }

  return events;
}

/**
 * Convenience wrapper to parse a RuntimeRequest coming from the core runtime.
 */
export function parseWhatsAppRuntimeRequest(request: RuntimeRequest): ParsedEvent[] {
  return parseWhatsAppWebhook(request.body);
}

export type {
  WhatsAppContact,
  WhatsAppMessage,
  WhatsAppMessageEventPayload,
  WhatsAppMetadata,
  WhatsAppStatus,
  WhatsAppStatusEventPayload
} from './types.js';
export {
  sendMessage,
  type WhatsAppHttpClient,
  type WhatsAppSendMessageConfig,
  type WhatsAppSendMessageResponse
} from './sendMessage.js';

import type { ParsedEvent, RuntimeRequest } from '@connectors/core-runtime';
import { safeParseOrThrow, ValidationError } from '@connectors/core-validation';

import type {
  WhatsAppContact,
  WhatsAppMessage,
  WhatsAppMessageEventPayload,
  WhatsAppMetadata,
  WhatsAppStatus,
  WhatsAppStatusEventPayload
} from './types.js';
import { webhookSchema, changeValueSchema, type WebhookPayload } from './schemas.js';

function toMetadata(input: WebhookPayload['entry'][number]['changes'][number]['value']['metadata']): WhatsAppMetadata {
  return {
    displayPhoneNumber: input.display_phone_number,
    phoneNumberId: input.phone_number_id
  };
}

function toContacts(input: NonNullable<WebhookPayload['entry'][number]['changes'][number]['value']['contacts']>): WhatsAppContact[] {
  return input.map((contact) => ({
    waId: contact.wa_id,
    name: contact.profile?.name
  }));
}

function toMessage(input: NonNullable<WebhookPayload['entry'][number]['changes'][number]['value']['messages']>[number]): WhatsAppMessage {
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

function toStatus(input: NonNullable<WebhookPayload['entry'][number]['changes'][number]['value']['statuses']>[number]): WhatsAppStatus {
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

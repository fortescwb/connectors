import { z } from 'zod';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ulidPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const e164Pattern = /^\+[1-9]\d{7,14}$/;

// ─────────────────────────────────────────────────────────────────────────────
// PAYLOAD SCHEMAS (WhatsApp principal outbound types)
// ─────────────────────────────────────────────────────────────────────────────

/** Text message payload */
export const TextMessagePayloadSchema = z.object({
  type: z.literal('text'),
  text: z.string().min(1, 'text must not be empty'),
  previewUrl: z.boolean().optional()
});

/** Audio message payload (via media ID or URL) - at least one must be provided */
export const AudioMessagePayloadSchema = z.object({
  type: z.literal('audio'),
  mediaId: z.string().min(1).optional(),
  mediaUrl: z.string().url().optional()
});

/** Document message payload - at least one of mediaId/mediaUrl must be provided */
export const DocumentMessagePayloadSchema = z.object({
  type: z.literal('document'),
  mediaId: z.string().min(1).optional(),
  mediaUrl: z.string().url().optional(),
  filename: z.string().min(1).optional(),
  caption: z.string().optional()
});

/** Image message payload - at least one of mediaId/mediaUrl must be provided */
export const ImageMessagePayloadSchema = z.object({
  type: z.literal('image'),
  mediaId: z.string().min(1).optional(),
  mediaUrl: z.string().url().optional(),
  caption: z.string().optional()
});

/** Contact info schema (for contacts message) */
export const ContactInfoSchema = z.object({
  name: z.object({
    formatted_name: z.string().min(1),
    first_name: z.string().optional(),
    last_name: z.string().optional()
  }),
  phones: z.array(z.object({
    phone: z.string().min(1),
    type: z.enum(['CELL', 'MAIN', 'IPHONE', 'HOME', 'WORK']).optional(),
    wa_id: z.string().optional()
  })).optional(),
  emails: z.array(z.object({
    email: z.string().email(),
    type: z.enum(['HOME', 'WORK']).optional()
  })).optional()
});

/** Contacts message payload */
export const ContactsMessagePayloadSchema = z.object({
  type: z.literal('contacts'),
  contacts: z.array(ContactInfoSchema).min(1, 'At least one contact is required')
});

/** Reaction message payload */
export const ReactionMessagePayloadSchema = z.object({
  type: z.literal('reaction'),
  messageId: z.string().min(1, 'messageId of the message to react to is required'),
  emoji: z.string().min(1, 'emoji is required (use empty string to remove reaction)')
});

/** Mark read payload (read receipt) */
export const MarkReadPayloadSchema = z.object({
  type: z.literal('mark_read'),
  messageId: z.string().min(1, 'messageId to mark as read is required')
});

/** Template component parameter */
export const TemplateParameterSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('currency'), fallback_value: z.string(), code: z.string(), amount_1000: z.number() }),
  z.object({ type: z.literal('date_time'), fallback_value: z.string() }),
  z.object({ type: z.literal('image'), image: z.object({ id: z.string().optional(), link: z.string().optional() }) }),
  z.object({ type: z.literal('document'), document: z.object({ id: z.string().optional(), link: z.string().optional(), filename: z.string().optional() }) }),
  z.object({ type: z.literal('video'), video: z.object({ id: z.string().optional(), link: z.string().optional() }) })
]);

/** Template component */
export const TemplateComponentSchema = z.object({
  type: z.enum(['header', 'body', 'button']),
  sub_type: z.enum(['quick_reply', 'url']).optional(),
  index: z.number().optional(),
  parameters: z.array(TemplateParameterSchema).optional()
});

/** Template message payload */
export const TemplateMessagePayloadSchema = z.object({
  type: z.literal('template'),
  templateName: z.string().min(1, 'templateName is required'),
  languageCode: z.string().min(2, 'languageCode is required (e.g., en_US, pt_BR)'),
  components: z.array(TemplateComponentSchema).optional()
});

/** Union of all supported outbound payload types */
export const OutboundMessagePayloadSchema = z.discriminatedUnion('type', [
  TextMessagePayloadSchema,
  AudioMessagePayloadSchema,
  DocumentMessagePayloadSchema,
  ImageMessagePayloadSchema,
  ContactsMessagePayloadSchema,
  ReactionMessagePayloadSchema,
  MarkReadPayloadSchema,
  TemplateMessagePayloadSchema
]);
export type OutboundMessagePayload = z.infer<typeof OutboundMessagePayloadSchema>;

export const OutboundMessageIntentSchema = z.object({
  intentId: z
    .string()
    .min(1)
    .refine((value) => uuidPattern.test(value) || ulidPattern.test(value), {
      message: 'intentId must be a UUID or ULID'
    }),
  tenantId: z.string().min(1, 'tenantId is required'),
  provider: z.literal('whatsapp'),
  to: z
    .string()
    .min(1, 'to is required')
    .regex(e164Pattern, 'to must be an E.164 phone number (e.g. +15551234567)'),
  payload: OutboundMessagePayloadSchema,
  dedupeKey: z.string().min(1, 'dedupeKey is required'),
  correlationId: z.string().min(1, 'correlationId is required'),
  createdAt: z.string().datetime({ message: 'createdAt must be an ISO datetime string' })
}).superRefine((data, ctx) => {
  // Validate that audio/document payloads have at least one media source
  const payload = data.payload;
  if (payload.type === 'audio') {
    if (!payload.mediaId && !payload.mediaUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either mediaId or mediaUrl must be provided for audio',
        path: ['payload']
      });
    }
  }
  if (payload.type === 'document') {
    if (!payload.mediaId && !payload.mediaUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either mediaId or mediaUrl must be provided for document',
        path: ['payload']
      });
    }
  }
});

export type OutboundMessageIntent = z.infer<typeof OutboundMessageIntentSchema>;

/**
 * Build a deterministic dedupe key for WhatsApp outbound intents.
 *
 * Stable inputs:
 * - tenantId: canonical tenant identifier
 * - intentId: upstream-generated UUID/ULID (also used as client_msg_id)
 *
 * Excludes the recipient phone number to avoid persisting PII in the dedupe store.
 */
export function buildWhatsAppOutboundDedupeKey(tenantId: string, intentId: string): string {
  if (!tenantId || !tenantId.trim()) {
    throw new Error('tenantId is required to build a WhatsApp outbound dedupe key');
  }
  if (!intentId || !intentId.trim()) {
    throw new Error('intentId is required to build a WhatsApp outbound dedupe key');
  }

  const normalizedTenant = tenantId.trim();
  const normalizedIntent = intentId.trim();

  return `whatsapp:tenant:${normalizedTenant}:intent:${normalizedIntent}`;
}

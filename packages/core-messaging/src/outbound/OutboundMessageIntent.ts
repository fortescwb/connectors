import { z } from 'zod';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ulidPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const e164Pattern = /^\+[1-9]\d{7,14}$/;

export const TextMessagePayloadSchema = z.object({
  type: z.literal('text'),
  text: z.string().min(1, 'text must not be empty'),
  previewUrl: z.boolean().optional()
});

export const OutboundMessagePayloadSchema = z.discriminatedUnion('type', [TextMessagePayloadSchema]);
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

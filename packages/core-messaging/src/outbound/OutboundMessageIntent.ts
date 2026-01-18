import { z } from 'zod';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ulidPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const e164Pattern = /^\+?[1-9]\d{7,14}$/;

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

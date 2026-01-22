import { z } from 'zod';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ulidPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const mediaSourceFields = {
  mediaId: z.string().min(1).optional(),
  url: z.string().url().optional()
} as const;

export const InstagramTextMessagePayloadSchema = z.object({
  type: z.literal('text'),
  text: z.string().min(1, 'text must not be empty')
});

export const InstagramLinkMessagePayloadSchema = z.object({
  type: z.literal('link'),
  url: z.string().url('url must be a valid URL'),
  text: z.string().min(1).optional()
});

export const InstagramImageMessagePayloadSchema = z.object({
  ...mediaSourceFields,
  type: z.literal('image'),
  caption: z.string().optional()
});

export const InstagramVideoMessagePayloadSchema = z.object({
  ...mediaSourceFields,
  type: z.literal('video'),
  caption: z.string().optional()
});

export const InstagramAudioMessagePayloadSchema = z.object({
  ...mediaSourceFields,
  type: z.literal('audio')
});

export const InstagramDocumentMessagePayloadSchema = z.object({
  ...mediaSourceFields,
  type: z.literal('document'),
  filename: z.string().optional()
});

export const InstagramOutboundMessagePayloadSchema = z.discriminatedUnion('type', [
  InstagramTextMessagePayloadSchema,
  InstagramLinkMessagePayloadSchema,
  InstagramImageMessagePayloadSchema,
  InstagramVideoMessagePayloadSchema,
  InstagramAudioMessagePayloadSchema,
  InstagramDocumentMessagePayloadSchema
]);
export type InstagramOutboundMessagePayload = z.infer<typeof InstagramOutboundMessagePayloadSchema>;

export const InstagramOutboundMessageIntentSchema = z.object({
  intentId: z
    .string()
    .min(1)
    .refine((value) => uuidPattern.test(value) || ulidPattern.test(value), {
      message: 'intentId must be a UUID or ULID'
    }),
  tenantId: z.string().min(1, 'tenantId is required'),
  provider: z.literal('instagram'),
  to: z.string().min(1, 'to is required'),
  payload: InstagramOutboundMessagePayloadSchema,
  dedupeKey: z.string().min(1, 'dedupeKey is required'),
  correlationId: z.string().min(1, 'correlationId is required'),
  createdAt: z.string().datetime({ message: 'createdAt must be an ISO datetime string' })
}).superRefine((data, ctx) => {
  const payload = data.payload;

  if (
    (payload.type === 'image' || payload.type === 'video' || payload.type === 'audio' || payload.type === 'document') &&
    !payload.mediaId &&
    !payload.url
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['payload'],
      message: 'Either mediaId or url must be provided for media payloads'
    });
  }
});

export type InstagramOutboundMessageIntent = z.infer<typeof InstagramOutboundMessageIntentSchema>;

/**
 * Build a deterministic dedupe key for Instagram outbound intents.
 * Keeps PII (recipient id/handle) out of the dedupe store.
 */
export function buildInstagramOutboundDedupeKey(tenantId: string, intentId: string): string {
  if (!tenantId || !tenantId.trim()) {
    throw new Error('tenantId is required to build an Instagram outbound dedupe key');
  }
  if (!intentId || !intentId.trim()) {
    throw new Error('intentId is required to build an Instagram outbound dedupe key');
  }

  const normalizedTenant = tenantId.trim();
  const normalizedIntent = intentId.trim();

  return `instagram:tenant:${normalizedTenant}:intent:${normalizedIntent}`;
}

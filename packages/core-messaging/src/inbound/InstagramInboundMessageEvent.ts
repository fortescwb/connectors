import { z } from 'zod';

const mediaPayloadBase = z.object({
  id: z.string().min(1).optional(),
  url: z.string().url().optional(),
  mimeType: z.string().optional()
});

export const InstagramInboundTextPayloadSchema = z.object({
  type: z.literal('text'),
  text: z.string().min(1, 'text must not be empty')
});

export const InstagramInboundImagePayloadSchema = mediaPayloadBase.extend({
  type: z.literal('image'),
  caption: z.string().optional()
});

export const InstagramInboundVideoPayloadSchema = mediaPayloadBase.extend({
  type: z.literal('video'),
  caption: z.string().optional()
});

export const InstagramInboundAudioPayloadSchema = mediaPayloadBase.extend({
  type: z.literal('audio')
});

export const InstagramInboundDocumentPayloadSchema = mediaPayloadBase.extend({
  type: z.literal('document'),
  filename: z.string().optional()
});

export const InstagramInboundMessagePayloadSchema = z.discriminatedUnion('type', [
  InstagramInboundTextPayloadSchema,
  InstagramInboundImagePayloadSchema,
  InstagramInboundVideoPayloadSchema,
  InstagramInboundAudioPayloadSchema,
  InstagramInboundDocumentPayloadSchema
]);
export type InstagramInboundMessagePayload = z.infer<typeof InstagramInboundMessagePayloadSchema>;

const timestampSchema = z.union([z.number(), z.string()]).transform((value) => {
  if (typeof value === 'number') {
    const ms = value > 9999999999 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  return new Date(value).toISOString();
});

export const InstagramInboundMessageEventSchema = z
  .object({
    provider: z.literal('instagram'),
    channel: z.literal('instagram_dm'),
    from: z.string().min(1, 'from is required'),
    to: z.string().min(1, 'to is required'),
    messageId: z.string().min(1, 'messageId is required'),
    timestamp: timestampSchema,
    payload: InstagramInboundMessagePayloadSchema,
    dedupeKey: z.string().min(1, 'dedupeKey is required'),
    correlationId: z.string().optional(),
    raw: z.record(z.unknown()).optional()
  })
  .superRefine((data, ctx) => {
    if (
      (data.payload.type === 'image' ||
        data.payload.type === 'video' ||
        data.payload.type === 'audio' ||
        data.payload.type === 'document') &&
      !data.payload.id &&
      !data.payload.url
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either id or url must be provided for media payloads'
      });
    }
  });

export type InstagramInboundMessageEvent = z.infer<typeof InstagramInboundMessageEventSchema>;

export function buildInstagramInboundDedupeKey(recipientId: string, messageId: string): string {
  if (!recipientId || !recipientId.trim()) {
    throw new Error('recipientId is required to build Instagram inbound dedupe key');
  }
  if (!messageId || !messageId.trim()) {
    throw new Error('messageId is required to build Instagram inbound dedupe key');
  }

  const normalizedRecipient = recipientId.trim();
  const normalizedMessage = messageId.trim();

  return `instagram:${normalizedRecipient}:msg:${normalizedMessage}`;
}

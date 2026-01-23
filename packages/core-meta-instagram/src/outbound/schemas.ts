import { z } from 'zod';

const AttachmentPayloadSchema = z
  .object({
    attachment_id: z.string().min(1).optional(),
    url: z.string().url().optional(),
    filename: z.string().min(1).optional()
  })
  .refine((value) => value.attachment_id || value.url, {
    message: 'attachment payload requires attachment_id or url'
  });

const AttachmentSchema = z.object({
  type: z.enum(['image', 'video', 'audio', 'file']),
  payload: AttachmentPayloadSchema
});

const MessageSchema = z
  .object({
    text: z.string().min(1).optional(),
    attachment: AttachmentSchema.optional()
  })
  .refine((value) => value.text || value.attachment, {
    message: 'message must include text or attachment'
  });

export const InstagramOutboundRequestBodySchema = z
  .object({
    messaging_type: z.literal('RESPONSE'),
    recipient: z.object({ id: z.string().min(1) }),
    message: MessageSchema,
    metadata: z.string().optional()
  })
  .strict();

export type InstagramOutboundRequestBody = z.infer<typeof InstagramOutboundRequestBodySchema>;

export const InstagramOutboundRequestSchema = z
  .object({
    method: z.literal('POST'),
    url: z.string().min(1),
    body: InstagramOutboundRequestBodySchema
  })
  .strict();

export type InstagramOutboundRequest = z.infer<typeof InstagramOutboundRequestSchema>;

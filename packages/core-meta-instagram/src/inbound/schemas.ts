import { z } from 'zod';

export const InstagramAttachmentSchema = z.object({
  type: z.string(),
  payload: z
    .object({
      url: z.string().url().optional(),
      sticker_id: z.string().optional(),
      id: z.string().optional()
    })
    .optional()
});

export const InstagramMessageSchema = z.object({
  mid: z.string().optional(),
  text: z.string().optional(),
  attachments: z.array(InstagramAttachmentSchema).optional()
});

export const InstagramMessagingSchema = z.object({
  sender: z.object({ id: z.string() }),
  recipient: z.object({ id: z.string() }),
  timestamp: z.number(),
  message: InstagramMessageSchema
});

export const InstagramEntrySchema = z.object({
  id: z.string(),
  time: z.number(),
  messaging: z.array(InstagramMessagingSchema)
});

export const InstagramWebhookSchema = z.object({
  object: z.literal('instagram').or(z.literal('page')).optional(),
  entry: z.array(InstagramEntrySchema)
});

export type InstagramWebhookBody = z.infer<typeof InstagramWebhookSchema>;

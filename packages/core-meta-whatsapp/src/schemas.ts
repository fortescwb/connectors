import { z } from 'zod';

export const metadataSchema = z.object({
  display_phone_number: z.string(),
  phone_number_id: z.string()
});

export const messageSchema = z.object({
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

export const statusSchema = z.object({
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

export const changeValueSchema = z.object({
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

export const changeSchema = z.object({
  field: z.string(),
  value: changeValueSchema
});

export const entrySchema = z.object({
  id: z.string(),
  changes: z.array(changeSchema)
});

export const webhookSchema = z.object({
  object: z.string(),
  entry: z.array(entrySchema)
});

export type WebhookPayload = z.infer<typeof webhookSchema>;

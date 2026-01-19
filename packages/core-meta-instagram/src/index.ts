import { safeParseOrThrow } from '@connectors/core-validation';
import type { ParsedEvent, RuntimeRequest } from '@connectors/core-runtime';
import { z } from 'zod';

import { CommentReplyCommandSchema } from '@connectors/core-comments';
import { parseInstagramWebhookPayload } from './parseWebhook.js';
import { sendCommentReplyBatch, type SendCommentReplyBatchOptions, type SendCommentReplyResult } from './replyClient.js';

export type InstagramWebhookBody = z.infer<typeof InstagramWebhookSchema>;

const InstagramMessageSchema = z.object({
  mid: z.string(),
  text: z.string().optional(),
  attachments: z
    .array(
      z.object({
        type: z.string(),
        payload: z.record(z.unknown()).optional()
      })
    )
    .optional()
});

const InstagramMessagingSchema = z.object({
  sender: z.object({ id: z.string() }),
  recipient: z.object({ id: z.string() }),
  timestamp: z.number(),
  message: InstagramMessageSchema
});

const InstagramEntrySchema = z.object({
  id: z.string(),
  time: z.number(),
  messaging: z.array(InstagramMessagingSchema)
});

export const InstagramWebhookSchema = z.object({
  object: z.literal('instagram').or(z.literal('page')).optional(),
  entry: z.array(InstagramEntrySchema)
});

export interface InstagramMessageNormalized {
  object?: string;
  entryId: string;
  senderId: string;
  recipientId: string;
  timestamp: number;
  mid: string;
  text?: string;
  attachments?: Array<{ type: string; payload?: Record<string, unknown> }>;
  raw: Record<string, unknown>;
}

/**
 * Parse Meta/Instagram webhook into ParsedEvent batch for inbound DMs.
 * Batch-safe: one ParsedEvent per messaging item.
 */
export function parseInstagramRuntimeRequest(request: RuntimeRequest): ParsedEvent<InstagramMessageNormalized>[] {
  const body = safeParseOrThrow(InstagramWebhookSchema, request.body, 'instagram-webhook');
  return parseInstagramWebhookPayload(body);
}

export {
  CommentReplyCommandSchema,
  sendCommentReplyBatch,
  type SendCommentReplyBatchOptions,
  type SendCommentReplyResult
};

import { z } from 'zod';

import type { TenantId } from '@connectors/core-tenant';

/**
 * Comment author information.
 */
export const CommentAuthorSchema = z.object({
  /** External user ID from the platform */
  externalUserId: z.string().min(1),

  /** Display name */
  displayName: z.string().optional(),

  /** Username/handle */
  username: z.string().optional(),

  /** Profile picture URL */
  avatarUrl: z.string().url().optional(),

  /** Is this the page/account owner */
  isOwner: z.boolean().default(false)
});
export type CommentAuthor = z.infer<typeof CommentAuthorSchema>;

/**
 * Comment content types.
 */
export const CommentContentTypeSchema = z.enum(['text', 'image', 'video', 'sticker', 'emoji']);
export type CommentContentType = z.infer<typeof CommentContentTypeSchema>;

/**
 * Comment content.
 */
export const CommentContentSchema = z.object({
  /** Content type */
  type: CommentContentTypeSchema,

  /** Text content (for text type or caption) */
  text: z.string().optional(),

  /** Media URL (for image/video) */
  mediaUrl: z.string().url().optional(),

  /** Sticker/emoji identifier */
  stickerId: z.string().optional()
});
export type CommentContent = z.infer<typeof CommentContentSchema>;

/**
 * Normalized comment from social media.
 */
export const SocialCommentSchema = z.object({
  /** External comment ID */
  externalCommentId: z.string().min(1),

  /** External post/media ID this comment is on */
  externalPostId: z.string().min(1),

  /** Parent comment ID (for replies) */
  parentCommentId: z.string().optional(),

  /** Platform/source (e.g., 'instagram', 'facebook') */
  platform: z.string().min(1),

  /** Comment author */
  author: CommentAuthorSchema,

  /** Comment content */
  content: CommentContentSchema,

  /** Comment creation timestamp */
  createdAt: z.string().datetime(),

  /** Is this a reply to another comment */
  isReply: z.boolean().default(false),

  /** Is this comment hidden/filtered */
  isHidden: z.boolean().default(false),

  /** Provider-specific metadata */
  meta: z.record(z.unknown()).optional()
});
export type SocialComment = z.infer<typeof SocialCommentSchema>;

/**
 * Comment event for ingestion.
 */
export interface CommentEvent {
  /** Tenant receiving the comment */
  tenantId: TenantId;

  /** Connector that captured the comment */
  connector: string;

  /** Normalized comment data */
  comment: SocialComment;

  /** Dedupe key for idempotency */
  dedupeKey: string;

  /** Correlation ID for tracing */
  correlationId?: string;
}

/**
 * Command to reply to a comment.
 */
export const CommentReplyCommandSchema = z.object({
  /** External comment ID to reply to */
  externalCommentId: z.string().min(1),

  /** External post ID (for context) */
  externalPostId: z.string().min(1),

  /** Platform */
  platform: z.string().min(1),

  /** Reply content */
  content: z.object({
    type: z.literal('text'),
    text: z.string().min(1)
  }),

  /** Tenant issuing the command */
  tenantId: z.string().min(1),

  /** Idempotency key */
  idempotencyKey: z.string().optional()
});
export type CommentReplyCommand = z.infer<typeof CommentReplyCommandSchema>;

/**
 * Result of a comment reply command.
 */
export interface CommentReplyResult {
  success: boolean;
  externalReplyId?: string;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Parse and validate a social comment.
 */
export function parseSocialComment(data: unknown): SocialComment {
  return SocialCommentSchema.parse(data);
}

/**
 * Parse and validate a comment reply command.
 */
export function parseCommentReplyCommand(data: unknown): CommentReplyCommand {
  return CommentReplyCommandSchema.parse(data);
}

/**
 * Build dedupe key for a comment.
 */
export function buildCommentDedupeKey(platform: string, externalCommentId: string): string {
  return `${platform.toLowerCase()}:comment:${externalCommentId}`;
}

/**
 * Build dedupe key for a comment reply command.
 */
export function buildCommentReplyDedupeKey(
  platform: string,
  externalCommentId: string,
  idempotencyKey?: string
): string {
  const suffix = idempotencyKey ?? Date.now().toString(36);
  return `${platform.toLowerCase()}:reply:${externalCommentId}:${suffix}`;
}

/**
 * Check if a comment is a direct reply (has parent).
 */
export function isDirectReply(comment: SocialComment): boolean {
  return !!comment.parentCommentId;
}

/**
 * Extract mentioned usernames from comment text.
 */
export function extractMentions(text: string): string[] {
  const mentionRegex = /@(\w+)/g;
  const matches = text.matchAll(mentionRegex);
  return [...matches].map((m) => m[1]);
}

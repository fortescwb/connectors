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
  idempotencyKey: z.string().min(1, 'idempotencyKey is required for outbound deduplication')
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
  tenantId: string,
  externalCommentId: string,
  idempotencyKey: string
): string {
  return `${platform.toLowerCase()}:tenant:${tenantId}:comment:${externalCommentId}:reply:${idempotencyKey}`;
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

// ─────────────────────────────────────────────────────────────────────────────
// META COMMENTS NORMALIZATION
// Helpers for converting Meta (Facebook/Instagram) comment raw data to normalized format
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Raw comment data structure from Meta webhook (Instagram/Facebook).
 * This is a subset of the actual Meta webhook payload.
 */
export interface MetaCommentRawData {
  /** Comment ID from Meta */
  id: string;

  /** Post/Media ID this comment is on */
  media_id?: string;
  post_id?: string;

  /** Parent comment ID (for replies) */
  parent_id?: string;

  /** Comment text */
  text: string;

  /** Timestamp when comment was created (ISO-8601 or Unix) */
  timestamp?: string;
  created_time?: string;

  /** Commenter information */
  from?: {
    id: string;
    name?: string;
    username?: string;
    profile_picture_url?: string;
  };

  /** Is this comment hidden */
  hidden?: boolean;

  /** Platform identifier */
  _platform?: 'instagram' | 'facebook';

  /** Original raw payload for debugging */
  _raw?: Record<string, unknown>;
}

/**
 * Build a SocialComment from Meta comment raw data.
 * This is a normalization helper for Meta webhook payloads.
 */
export function buildSocialCommentFromMetaRaw(raw: MetaCommentRawData): SocialComment {
  const platform = raw._platform ?? 'instagram';
  const externalPostId = raw.media_id ?? raw.post_id ?? '';
  const timestamp = raw.timestamp ?? raw.created_time ?? new Date().toISOString();

  return {
    externalCommentId: raw.id,
    externalPostId,
    parentCommentId: raw.parent_id,
    platform,
    author: {
      externalUserId: raw.from?.id ?? 'unknown',
      displayName: raw.from?.name,
      username: raw.from?.username,
      avatarUrl: raw.from?.profile_picture_url,
      isOwner: false
    },
    content: {
      type: 'text',
      text: raw.text
    },
    createdAt: timestamp,
    isReply: !!raw.parent_id,
    isHidden: raw.hidden ?? false,
    meta: raw._raw ? { raw: raw._raw } : undefined
  };
}

/**
 * Build dedupe key for a comment.
 * Uses platform + comment ID for stable deduplication.
 */
export function dedupeKeyComment(comment: SocialComment): string {
  return buildCommentDedupeKey(comment.platform, comment.externalCommentId);
}

/**
 * Build dedupe key for a Meta comment from raw data.
 */
export function dedupeKeyCommentFromRaw(raw: MetaCommentRawData): string {
  const platform = raw._platform ?? 'instagram';
  return buildCommentDedupeKey(platform, raw.id);
}

/**
 * Extract minimal normalized author info from Meta raw comment.
 */
export function extractAuthorFromMetaRaw(raw: MetaCommentRawData): CommentAuthor {
  return {
    externalUserId: raw.from?.id ?? 'unknown',
    displayName: raw.from?.name,
    username: raw.from?.username,
    avatarUrl: raw.from?.profile_picture_url,
    isOwner: false
  };
}

/**
 * Validate that a raw Meta comment has minimum required fields.
 */
export function isValidMetaCommentRaw(raw: unknown): raw is MetaCommentRawData {
  if (!raw || typeof raw !== 'object') return false;
  const data = raw as Record<string, unknown>;
  return (
    typeof data.id === 'string' &&
    data.id.length > 0 &&
    typeof data.text === 'string'
  );
}

/**
 * Check if a Meta comment is a reply to another comment.
 */
export function isMetaCommentReply(raw: MetaCommentRawData): boolean {
  return !!raw.parent_id;
}

/**
 * Extract post/media ID from Meta raw comment.
 */
export function extractPostIdFromMetaRaw(raw: MetaCommentRawData): string | undefined {
  return raw.media_id ?? raw.post_id;
}

import { describe, expect, it } from 'vitest';

import {
  buildCommentDedupeKey,
  buildCommentReplyDedupeKey,
  extractMentions,
  isDirectReply,
  parseCommentReplyCommand,
  parseSocialComment,
  type SocialComment
} from '../src/index.js';

describe('core-comments', () => {
  const validComment: SocialComment = {
    externalCommentId: 'comment-123',
    externalPostId: 'post-456',
    platform: 'instagram',
    author: {
      externalUserId: 'user-789',
      displayName: 'John Doe',
      username: 'johndoe',
      isOwner: false
    },
    content: {
      type: 'text',
      text: 'Great post! @jane @bob'
    },
    createdAt: '2026-01-17T10:00:00.000Z',
    isReply: false,
    isHidden: false
  };

  describe('parseSocialComment', () => {
    it('parses valid comment', () => {
      const result = parseSocialComment(validComment);
      expect(result.externalCommentId).toBe('comment-123');
      expect(result.platform).toBe('instagram');
      expect(result.author.username).toBe('johndoe');
    });

    it('throws on missing required fields', () => {
      const invalid = { ...validComment, externalCommentId: '' };
      expect(() => parseSocialComment(invalid)).toThrow();
    });

    it('applies defaults', () => {
      const minimal = {
        externalCommentId: 'c-1',
        externalPostId: 'p-1',
        platform: 'facebook',
        author: { externalUserId: 'u-1' },
        content: { type: 'text', text: 'Hello' },
        createdAt: '2026-01-17T10:00:00.000Z'
      };
      const result = parseSocialComment(minimal);
      expect(result.isReply).toBe(false);
      expect(result.isHidden).toBe(false);
      expect(result.author.isOwner).toBe(false);
    });
  });

  describe('parseCommentReplyCommand', () => {
    it('parses valid reply command', () => {
      const command = {
        externalCommentId: 'comment-123',
        externalPostId: 'post-456',
        platform: 'instagram',
        content: { type: 'text', text: 'Thanks for your comment!' },
        tenantId: 'tenant-1'
      };
      const result = parseCommentReplyCommand(command);
      expect(result.externalCommentId).toBe('comment-123');
      expect(result.content.text).toBe('Thanks for your comment!');
    });

    it('throws on empty reply text', () => {
      const invalid = {
        externalCommentId: 'comment-123',
        externalPostId: 'post-456',
        platform: 'instagram',
        content: { type: 'text', text: '' },
        tenantId: 'tenant-1'
      };
      expect(() => parseCommentReplyCommand(invalid)).toThrow();
    });
  });

  describe('buildCommentDedupeKey', () => {
    it('builds consistent dedupe key', () => {
      const key = buildCommentDedupeKey('Instagram', 'comment-123');
      expect(key).toBe('instagram:comment:comment-123');
    });
  });

  describe('buildCommentReplyDedupeKey', () => {
    it('builds key with idempotency key', () => {
      const key = buildCommentReplyDedupeKey('instagram', 'comment-123', 'idem-456');
      expect(key).toBe('instagram:reply:comment-123:idem-456');
    });

    it('builds key with timestamp when no idempotency key', () => {
      const key = buildCommentReplyDedupeKey('instagram', 'comment-123');
      expect(key).toMatch(/^instagram:reply:comment-123:\w+$/);
    });
  });

  describe('isDirectReply', () => {
    it('returns true when parentCommentId exists', () => {
      const reply: SocialComment = {
        ...validComment,
        parentCommentId: 'parent-comment-1',
        isReply: true
      };
      expect(isDirectReply(reply)).toBe(true);
    });

    it('returns false when parentCommentId is missing', () => {
      expect(isDirectReply(validComment)).toBe(false);
    });
  });

  describe('extractMentions', () => {
    it('extracts mentioned usernames', () => {
      const mentions = extractMentions('Hello @alice and @bob!');
      expect(mentions).toEqual(['alice', 'bob']);
    });

    it('returns empty array when no mentions', () => {
      const mentions = extractMentions('Hello world!');
      expect(mentions).toEqual([]);
    });

    it('handles text from validComment', () => {
      const mentions = extractMentions(validComment.content.text!);
      expect(mentions).toEqual(['jane', 'bob']);
    });
  });
});

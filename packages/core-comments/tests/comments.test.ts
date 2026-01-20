import { describe, expect, it } from 'vitest';

import {
  buildCommentDedupeKey,
  buildCommentReplyDedupeKey,
  buildSocialCommentFromMetaRaw,
  dedupeKeyComment,
  dedupeKeyCommentFromRaw,
  extractAuthorFromMetaRaw,
  extractMentions,
  extractPostIdFromMetaRaw,
  isDirectReply,
  isMetaCommentReply,
  isValidMetaCommentRaw,
  parseCommentReplyCommand,
  parseSocialComment,
  type MetaCommentRawData,
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
        pageId: 'page-789',
        platform: 'instagram',
        content: { type: 'text', text: 'Thanks for your comment!' },
        tenantId: 'tenant-1',
        idempotencyKey: 'reply-1'
      };
      const result = parseCommentReplyCommand(command);
      expect(result.externalCommentId).toBe('comment-123');
      expect(result.content.text).toBe('Thanks for your comment!');
    });

    it('throws on empty reply text', () => {
      const invalid = {
        externalCommentId: 'comment-123',
        externalPostId: 'post-456',
        pageId: 'page-789',
        platform: 'instagram',
        content: { type: 'text', text: '' },
        tenantId: 'tenant-1',
        idempotencyKey: 'reply-1'
      };
      expect(() => parseCommentReplyCommand(invalid)).toThrow();
    });

    it('throws when idempotencyKey is missing', () => {
      const invalid = {
        externalCommentId: 'comment-123',
        externalPostId: 'post-456',
        pageId: 'page-789',
        platform: 'instagram',
        content: { type: 'text', text: 'Hello' },
        tenantId: 'tenant-1'
      };
      expect(() => parseCommentReplyCommand(invalid)).toThrow(/idempotencyKey/);
    });
  });

  describe('buildCommentDedupeKey', () => {
    it('builds consistent dedupe key', () => {
      const key = buildCommentDedupeKey('Instagram', 'comment-123');
      expect(key).toBe('instagram:comment:comment-123');
    });
  });

  describe('buildCommentReplyDedupeKey', () => {
    it('builds key anchored on page and comment', () => {
      const key = buildCommentReplyDedupeKey('instagram', 'tenant-1', 'page-789', 'comment-123');
      expect(key).toBe('instagram:tenant:tenant-1:page:page-789:comment:comment-123:reply');
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

  describe('Meta Comment normalization', () => {
    const validMetaRaw: MetaCommentRawData = {
      id: 'meta-comment-12345',
      media_id: 'meta-media-67890',
      text: 'Amazing photo! 📸',
      timestamp: '2026-01-17T15:30:00Z',
      from: {
        id: 'meta-user-111',
        name: 'Jane Smith',
        username: 'janesmith',
        profile_picture_url: 'https://cdn.instagram.com/avatars/janesmith.jpg'
      },
      hidden: false,
      _platform: 'instagram'
    };

    describe('buildSocialCommentFromMetaRaw', () => {
      it('converts Meta raw data to SocialComment', () => {
        const comment = buildSocialCommentFromMetaRaw(validMetaRaw);
        expect(comment.externalCommentId).toBe('meta-comment-12345');
        expect(comment.externalPostId).toBe('meta-media-67890');
        expect(comment.platform).toBe('instagram');
        expect(comment.content.type).toBe('text');
        expect(comment.content.text).toBe('Amazing photo! 📸');
        expect(comment.isReply).toBe(false);
        expect(comment.isHidden).toBe(false);
      });

      it('maps author correctly', () => {
        const comment = buildSocialCommentFromMetaRaw(validMetaRaw);
        expect(comment.author.externalUserId).toBe('meta-user-111');
        expect(comment.author.displayName).toBe('Jane Smith');
        expect(comment.author.username).toBe('janesmith');
        expect(comment.author.avatarUrl).toBe('https://cdn.instagram.com/avatars/janesmith.jpg');
      });

      it('handles replies with parent_id', () => {
        const replyRaw: MetaCommentRawData = {
          ...validMetaRaw,
          parent_id: 'parent-comment-999'
        };
        const comment = buildSocialCommentFromMetaRaw(replyRaw);
        expect(comment.parentCommentId).toBe('parent-comment-999');
        expect(comment.isReply).toBe(true);
      });

      it('handles hidden comments', () => {
        const hiddenRaw: MetaCommentRawData = {
          ...validMetaRaw,
          hidden: true
        };
        const comment = buildSocialCommentFromMetaRaw(hiddenRaw);
        expect(comment.isHidden).toBe(true);
      });

      it('uses post_id when media_id not present', () => {
        const facebookRaw: MetaCommentRawData = {
          ...validMetaRaw,
          media_id: undefined,
          post_id: 'fb-post-123',
          _platform: 'facebook'
        };
        const comment = buildSocialCommentFromMetaRaw(facebookRaw);
        expect(comment.externalPostId).toBe('fb-post-123');
        expect(comment.platform).toBe('facebook');
      });

      it('defaults platform to instagram', () => {
        const rawWithoutPlatform: MetaCommentRawData = {
          ...validMetaRaw,
          _platform: undefined
        };
        const comment = buildSocialCommentFromMetaRaw(rawWithoutPlatform);
        expect(comment.platform).toBe('instagram');
      });

      it('preserves raw data when provided', () => {
        const rawWithDebug: MetaCommentRawData = {
          ...validMetaRaw,
          _raw: { original: 'webhook' }
        };
        const comment = buildSocialCommentFromMetaRaw(rawWithDebug);
        expect(comment.meta).toEqual({ raw: { original: 'webhook' } });
      });

      it('handles missing from field', () => {
        const rawWithoutFrom: MetaCommentRawData = {
          ...validMetaRaw,
          from: undefined
        };
        const comment = buildSocialCommentFromMetaRaw(rawWithoutFrom);
        expect(comment.author.externalUserId).toBe('unknown');
      });
    });

    describe('dedupeKeyComment', () => {
      it('builds stable dedupe key from SocialComment', () => {
        const comment = buildSocialCommentFromMetaRaw(validMetaRaw);
        const key = dedupeKeyComment(comment);
        expect(key).toBe('instagram:comment:meta-comment-12345');
      });

      it('is deterministic for same input', () => {
        const comment = buildSocialCommentFromMetaRaw(validMetaRaw);
        const key1 = dedupeKeyComment(comment);
        const key2 = dedupeKeyComment(comment);
        expect(key1).toBe(key2);
      });
    });

    describe('dedupeKeyCommentFromRaw', () => {
      it('builds stable dedupe key from raw data', () => {
        const key = dedupeKeyCommentFromRaw(validMetaRaw);
        expect(key).toBe('instagram:comment:meta-comment-12345');
      });

      it('matches dedupeKeyComment output', () => {
        const comment = buildSocialCommentFromMetaRaw(validMetaRaw);
        expect(dedupeKeyCommentFromRaw(validMetaRaw)).toBe(dedupeKeyComment(comment));
      });

      it('uses default platform when not specified', () => {
        const rawWithoutPlatform: MetaCommentRawData = {
          ...validMetaRaw,
          _platform: undefined
        };
        const key = dedupeKeyCommentFromRaw(rawWithoutPlatform);
        expect(key).toBe('instagram:comment:meta-comment-12345');
      });
    });

    describe('extractAuthorFromMetaRaw', () => {
      it('extracts author info from raw data', () => {
        const author = extractAuthorFromMetaRaw(validMetaRaw);
        expect(author.externalUserId).toBe('meta-user-111');
        expect(author.displayName).toBe('Jane Smith');
        expect(author.username).toBe('janesmith');
      });

      it('handles missing from field', () => {
        const rawWithoutFrom: MetaCommentRawData = {
          ...validMetaRaw,
          from: undefined
        };
        const author = extractAuthorFromMetaRaw(rawWithoutFrom);
        expect(author.externalUserId).toBe('unknown');
      });
    });

    describe('isValidMetaCommentRaw', () => {
      it('returns true for valid raw data', () => {
        expect(isValidMetaCommentRaw(validMetaRaw)).toBe(true);
      });

      it('returns false for missing id', () => {
        const invalid = { ...validMetaRaw, id: '' };
        expect(isValidMetaCommentRaw(invalid)).toBe(false);
      });

      it('returns false for non-string text', () => {
        const invalid = { ...validMetaRaw, text: 123 };
        expect(isValidMetaCommentRaw(invalid)).toBe(false);
      });

      it('returns false for null/undefined', () => {
        expect(isValidMetaCommentRaw(null)).toBe(false);
        expect(isValidMetaCommentRaw(undefined)).toBe(false);
      });

      it('returns false for non-object', () => {
        expect(isValidMetaCommentRaw('string')).toBe(false);
        expect(isValidMetaCommentRaw(123)).toBe(false);
      });
    });

    describe('isMetaCommentReply', () => {
      it('returns true when parent_id exists', () => {
        const replyRaw: MetaCommentRawData = {
          ...validMetaRaw,
          parent_id: 'parent-123'
        };
        expect(isMetaCommentReply(replyRaw)).toBe(true);
      });

      it('returns false when no parent_id', () => {
        expect(isMetaCommentReply(validMetaRaw)).toBe(false);
      });
    });

    describe('extractPostIdFromMetaRaw', () => {
      it('extracts media_id when present', () => {
        expect(extractPostIdFromMetaRaw(validMetaRaw)).toBe('meta-media-67890');
      });

      it('extracts post_id when media_id missing', () => {
        const facebookRaw: MetaCommentRawData = {
          ...validMetaRaw,
          media_id: undefined,
          post_id: 'fb-post-456'
        };
        expect(extractPostIdFromMetaRaw(facebookRaw)).toBe('fb-post-456');
      });

      it('returns undefined when neither present', () => {
        const rawWithoutPost: MetaCommentRawData = {
          ...validMetaRaw,
          media_id: undefined,
          post_id: undefined
        };
        expect(extractPostIdFromMetaRaw(rawWithoutPost)).toBeUndefined();
      });
    });
  });
});

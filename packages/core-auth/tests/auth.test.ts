import { describe, expect, it, beforeEach } from 'vitest';

import {
  canRefreshToken,
  createTokenInfo,
  InMemoryTokenStorage,
  isTokenExpired,
  parseTokenInfo,
  type TokenInfo,
  type TokenStorageKey
} from '../src/index.js';

describe('core-auth', () => {
  describe('TokenInfo', () => {
    it('parses valid token info', () => {
      const data = {
        accessToken: 'abc123',
        tokenType: 'Bearer',
        expiresAt: '2026-12-31T23:59:59.000Z',
        refreshToken: 'refresh456',
        scopes: ['read', 'write']
      };
      const token = parseTokenInfo(data);
      expect(token.accessToken).toBe('abc123');
      expect(token.scopes).toEqual(['read', 'write']);
    });

    it('throws on missing accessToken', () => {
      const data = { tokenType: 'Bearer' };
      expect(() => parseTokenInfo(data)).toThrow();
    });

    it('applies defaults', () => {
      const token = parseTokenInfo({ accessToken: 'abc' });
      expect(token.tokenType).toBe('Bearer');
      expect(token.scopes).toEqual([]);
    });
  });

  describe('createTokenInfo', () => {
    it('creates token with expiration', () => {
      const token = createTokenInfo('access123', {
        expiresInSeconds: 3600,
        refreshToken: 'refresh456',
        scopes: ['email']
      });
      expect(token.accessToken).toBe('access123');
      expect(token.refreshToken).toBe('refresh456');
      expect(token.expiresAt).toBeDefined();
      expect(token.scopes).toEqual(['email']);
    });

    it('creates token without expiration', () => {
      const token = createTokenInfo('access123');
      expect(token.expiresAt).toBeUndefined();
    });
  });

  describe('isTokenExpired', () => {
    it('returns false for non-expiring token', () => {
      const token: TokenInfo = {
        accessToken: 'abc',
        tokenType: 'Bearer',
        scopes: []
      };
      expect(isTokenExpired(token)).toBe(false);
    });

    it('returns true for expired token', () => {
      const token: TokenInfo = {
        accessToken: 'abc',
        tokenType: 'Bearer',
        expiresAt: '2020-01-01T00:00:00.000Z',
        scopes: []
      };
      expect(isTokenExpired(token)).toBe(true);
    });

    it('returns true when within buffer', () => {
      const almostExpired = new Date(Date.now() + 2 * 60 * 1000).toISOString(); // 2 minutes
      const token: TokenInfo = {
        accessToken: 'abc',
        tokenType: 'Bearer',
        expiresAt: almostExpired,
        scopes: []
      };
      // Default buffer is 5 minutes
      expect(isTokenExpired(token)).toBe(true);
    });

    it('returns false when outside buffer', () => {
      const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
      const token: TokenInfo = {
        accessToken: 'abc',
        tokenType: 'Bearer',
        expiresAt: farFuture,
        scopes: []
      };
      expect(isTokenExpired(token)).toBe(false);
    });
  });

  describe('canRefreshToken', () => {
    it('returns true when refreshToken exists', () => {
      const token: TokenInfo = {
        accessToken: 'abc',
        tokenType: 'Bearer',
        refreshToken: 'refresh123',
        scopes: []
      };
      expect(canRefreshToken(token)).toBe(true);
    });

    it('returns false when refreshToken is missing', () => {
      const token: TokenInfo = {
        accessToken: 'abc',
        tokenType: 'Bearer',
        scopes: []
      };
      expect(canRefreshToken(token)).toBe(false);
    });
  });

  describe('InMemoryTokenStorage', () => {
    let storage: InMemoryTokenStorage;
    const key: TokenStorageKey = {
      connector: 'instagram',
      tenantId: 'tenant-1',
      accountId: 'account-1'
    };
    const token: TokenInfo = {
      accessToken: 'test-token',
      tokenType: 'Bearer',
      scopes: []
    };

    beforeEach(() => {
      storage = new InMemoryTokenStorage();
    });

    it('stores and retrieves tokens', async () => {
      await storage.set(key, token);
      const retrieved = await storage.get(key);
      expect(retrieved).toEqual(token);
    });

    it('returns undefined for missing key', async () => {
      const result = await storage.get(key);
      expect(result).toBeUndefined();
    });

    it('checks existence correctly', async () => {
      expect(await storage.exists(key)).toBe(false);
      await storage.set(key, token);
      expect(await storage.exists(key)).toBe(true);
    });

    it('deletes tokens', async () => {
      await storage.set(key, token);
      await storage.delete(key);
      expect(await storage.exists(key)).toBe(false);
    });

    it('handles keys without accountId', async () => {
      const simpleKey: TokenStorageKey = {
        connector: 'whatsapp',
        tenantId: 'tenant-2'
      };
      await storage.set(simpleKey, token);
      const retrieved = await storage.get(simpleKey);
      expect(retrieved).toEqual(token);
    });
  });
});

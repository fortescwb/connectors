import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  RedisDedupeStore,
  createRedisDedupeStore,
  type RedisClient
} from '../src/redis-dedupe-store.js';

// ─────────────────────────────────────────────────────────────────────────────
// MOCK REDIS CLIENT
// ─────────────────────────────────────────────────────────────────────────────

function createMockRedisClient(overrides: Partial<RedisClient> = {}): RedisClient {
  return {
    set: vi.fn().mockResolvedValue('OK'),
    exists: vi.fn().mockResolvedValue(0),
    ...overrides
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('RedisDedupeStore', () => {
  describe('checkAndMark', () => {
    it('returns false for new keys (not duplicate)', async () => {
      const client = createMockRedisClient({
        set: vi.fn().mockResolvedValue('OK') // 'OK' = key was set (new)
      });
      const store = new RedisDedupeStore({ client });

      const result = await store.checkAndMark('event-123', 300000);

      expect(result).toBe(false); // Not a duplicate
      expect(client.set).toHaveBeenCalledWith(
        'dedupe:event-123',
        '1',
        'NX',
        'PX',
        300000
      );
    });

    it('returns true for existing keys (duplicate)', async () => {
      const client = createMockRedisClient({
        set: vi.fn().mockResolvedValue(null) // null = key already exists
      });
      const store = new RedisDedupeStore({ client });

      const result = await store.checkAndMark('event-123', 300000);

      expect(result).toBe(true); // Is a duplicate
    });

    it('respects custom key prefix', async () => {
      const client = createMockRedisClient();
      const store = new RedisDedupeStore({
        client,
        keyPrefix: 'myapp:dedupe:'
      });

      await store.checkAndMark('event-456', 60000);

      expect(client.set).toHaveBeenCalledWith(
        'myapp:dedupe:event-456',
        '1',
        'NX',
        'PX',
        60000
      );
    });

    it('passes TTL correctly to Redis', async () => {
      const client = createMockRedisClient();
      const store = new RedisDedupeStore({ client });

      await store.checkAndMark('event-789', 120000);

      expect(client.set).toHaveBeenCalledWith(
        'dedupe:event-789',
        '1',
        'NX',
        'PX',
        120000
      );
    });
  });

  describe('error handling', () => {
    it('fails open by default (returns true on error)', async () => {
      const client = createMockRedisClient({
        set: vi.fn().mockRejectedValue(new Error('Redis connection failed'))
      });
      const store = new RedisDedupeStore({ client });

      const result = await store.checkAndMark('event-123', 300000);

      expect(result).toBe(true); // Treated as duplicate (fail open)
    });

    it('fails open when failMode is "open"', async () => {
      const client = createMockRedisClient({
        set: vi.fn().mockRejectedValue(new Error('Redis timeout'))
      });
      const store = new RedisDedupeStore({ client, failMode: 'open' });

      const result = await store.checkAndMark('event-123', 300000);

      expect(result).toBe(true); // Block processing
    });

    it('fails closed when failMode is "closed"', async () => {
      const client = createMockRedisClient({
        set: vi.fn().mockRejectedValue(new Error('Redis timeout'))
      });
      const store = new RedisDedupeStore({ client, failMode: 'closed' });

      const result = await store.checkAndMark('event-123', 300000);

      expect(result).toBe(false); // Allow processing
    });

    it('calls onError handler on failure', async () => {
      const onError = vi.fn();
      const client = createMockRedisClient({
        set: vi.fn().mockRejectedValue(new Error('Redis error'))
      });
      const store = new RedisDedupeStore({ client, onError });

      await store.checkAndMark('event-123', 300000);

      expect(onError).toHaveBeenCalledWith(
        expect.any(Error),
        { key: 'dedupe:event-123', operation: 'checkAndMark' }
      );
      expect(onError.mock.calls[0][0].message).toBe('Redis error');
    });

    it('handles non-Error objects thrown', async () => {
      const onError = vi.fn();
      const client = createMockRedisClient({
        set: vi.fn().mockRejectedValue('string error')
      });
      const store = new RedisDedupeStore({ client, onError });

      const result = await store.checkAndMark('event-123', 300000);

      expect(result).toBe(true); // Fail open
      expect(onError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.any(Object)
      );
    });
  });

  describe('createRedisDedupeStore factory', () => {
    it('creates a RedisDedupeStore instance', async () => {
      const client = createMockRedisClient();
      const store = createRedisDedupeStore({ client });

      const result = await store.checkAndMark('test-key', 60000);

      expect(result).toBe(false);
      expect(client.set).toHaveBeenCalled();
    });

    it('accepts all options', async () => {
      const onError = vi.fn();
      const client = createMockRedisClient({
        set: vi.fn().mockRejectedValue(new Error('fail'))
      });

      const store = createRedisDedupeStore({
        client,
        keyPrefix: 'custom:',
        failMode: 'closed',
        onError
      });

      const result = await store.checkAndMark('key', 1000);

      expect(result).toBe(false); // Fail closed
      expect(onError).toHaveBeenCalled();
    });
  });

  describe('TTL behavior simulation', () => {
    let storedKeys: Map<string, { value: string; expiresAt: number }>;
    let mockClient: RedisClient;

    beforeEach(() => {
      storedKeys = new Map();

      mockClient = {
        set: vi.fn(async (key: string, value: string, _mode: 'NX', _flag: 'PX', ttlMs: number) => {
          const now = Date.now();
          const existing = storedKeys.get(key);

          // Check if key exists and not expired
          if (existing && existing.expiresAt > now) {
            return null; // Key exists
          }

          // Set new key with TTL
          storedKeys.set(key, { value, expiresAt: now + ttlMs });
          return 'OK';
        }),
        exists: vi.fn(async (key: string) => {
          const existing = storedKeys.get(key);
          if (existing && existing.expiresAt > Date.now()) {
            return 1;
          }
          return 0;
        })
      };
    });

    it('first call marks key, second call detects duplicate', async () => {
      const store = new RedisDedupeStore({ client: mockClient });

      const first = await store.checkAndMark('event-1', 300000);
      const second = await store.checkAndMark('event-1', 300000);

      expect(first).toBe(false); // New key
      expect(second).toBe(true); // Duplicate
    });

    it('allows reprocessing after TTL expires', async () => {
      const store = new RedisDedupeStore({ client: mockClient });
      const ttlMs = 100; // Short TTL for test

      const first = await store.checkAndMark('event-2', ttlMs);
      expect(first).toBe(false);

      // Simulate TTL expiration
      const entry = storedKeys.get('dedupe:event-2');
      if (entry) {
        entry.expiresAt = Date.now() - 1; // Expired
      }

      const second = await store.checkAndMark('event-2', ttlMs);
      expect(second).toBe(false); // Key expired, treated as new
    });

    it('different keys are independent', async () => {
      const store = new RedisDedupeStore({ client: mockClient });

      const result1 = await store.checkAndMark('event-a', 300000);
      const result2 = await store.checkAndMark('event-b', 300000);
      const result3 = await store.checkAndMark('event-a', 300000);

      expect(result1).toBe(false); // New
      expect(result2).toBe(false); // New (different key)
      expect(result3).toBe(true); // Duplicate of event-a
    });
  });
});

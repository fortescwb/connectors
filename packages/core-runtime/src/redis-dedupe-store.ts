/**
 * Redis-based DedupeStore for distributed environments.
 *
 * This module provides a persistent deduplication store using Redis.
 * It is isolated from the core runtime to avoid mandatory Redis dependency.
 *
 * @example
 * ```typescript
 * import Redis from 'ioredis';
 * import { createRedisDedupeStore } from '@connectors/core-runtime/redis-dedupe-store';
 *
 * const redis = new Redis(process.env.REDIS_URL);
 * const dedupeStore = createRedisDedupeStore({ client: redis });
 *
 * const runtime = createConnectorRuntime({
 *   // ...
 *   dedupeStore,
 * });
 * ```
 */

import type { DedupeStore } from './index.js';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal Redis client interface.
 * Compatible with ioredis, node-redis, and similar clients.
 */
export interface RedisClient {
  /**
   * SET with NX (only set if not exists) and PX (TTL in milliseconds).
   * @returns 'OK' if key was set, null if key already exists
   */
  set(key: string, value: string, mode: 'NX', flag: 'PX', ttlMs: number): Promise<string | null>;

  /**
   * Check if a key exists.
   * @returns 1 if exists, 0 if not
   */
  exists(key: string): Promise<number>;
}

/**
 * Options for creating a Redis DedupeStore.
 */
export interface RedisDedupeStoreOptions {
  /**
   * Redis client instance.
   * Must implement `set` with NX/PX and `exists` commands.
   */
  client: RedisClient;

  /**
   * Key prefix for dedupe keys.
   * @default 'dedupe:'
   */
  keyPrefix?: string;

  /**
   * Behavior when Redis operations fail.
   * - 'closed': Fail closed - treat as not duplicate, allowing processing (fail-safe but may cause duplicates)
   * - 'open': Fail open - treat as duplicate, blocking processing (fail-secure, no duplicates but may drop events)
   * @default 'open'
   */
  failMode?: 'closed' | 'open';

  /**
   * Optional logger for error reporting.
   */
  onError?: (error: Error, context: { key: string; operation: string }) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Redis-based deduplication store.
 * Uses SET NX PX for atomic check-and-mark with TTL.
 */
export class RedisDedupeStore implements DedupeStore {
  private readonly client: RedisClient;
  private readonly keyPrefix: string;
  private readonly failMode: 'closed' | 'open';
  private readonly onError?: (error: Error, context: { key: string; operation: string }) => void;

  constructor(options: RedisDedupeStoreOptions) {
    this.client = options.client;
    this.keyPrefix = options.keyPrefix ?? 'dedupe:';
    this.failMode = options.failMode ?? 'open';
    this.onError = options.onError;
  }

  /**
   * Check if a key is duplicate and mark it as seen atomically.
   * Uses Redis SET NX PX for atomic operation with TTL.
   *
   * @param key Unique event identifier
   * @param ttlMs Time-to-live for the key in milliseconds
   * @returns true if already seen (duplicate), false otherwise
   * @throws Never throws - returns based on failMode on Redis errors
   */
  async checkAndMark(key: string, ttlMs: number): Promise<boolean> {
    const redisKey = `${this.keyPrefix}${key}`;

    try {
      // SET NX PX: Set only if not exists, with TTL in milliseconds
      // Returns 'OK' if set (new key), null if already exists (duplicate)
      const result = await this.client.set(redisKey, '1', 'NX', 'PX', ttlMs);

      // 'OK' means key was set → not a duplicate
      // null means key already exists → duplicate
      return result === null;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      // Report error if handler provided
      this.onError?.(err, { key: redisKey, operation: 'checkAndMark' });

      // Fail mode determines behavior on error
      if (this.failMode === 'open') {
        // Fail open: treat as duplicate to prevent processing
        // This is safer - avoids potential duplicate processing
        return true;
      } else {
        // Fail closed: treat as not duplicate, allow processing
        // May cause duplicates but won't drop events
        return false;
      }
    }
  }
}

/**
 * Create a Redis-based DedupeStore.
 *
 * @example
 * ```typescript
 * import Redis from 'ioredis';
 * import { createRedisDedupeStore } from '@connectors/core-runtime/redis-dedupe-store';
 *
 * const redis = new Redis(process.env.REDIS_URL);
 * const dedupeStore = createRedisDedupeStore({
 *   client: redis,
 *   keyPrefix: 'myapp:dedupe:',
 *   failMode: 'open', // Block on Redis errors (safer)
 *   onError: (err, ctx) => console.error('Redis dedupe error', err, ctx),
 * });
 * ```
 */
export function createRedisDedupeStore(options: RedisDedupeStoreOptions): DedupeStore {
  return new RedisDedupeStore(options);
}

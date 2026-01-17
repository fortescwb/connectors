import { describe, expect, it, beforeEach, vi } from 'vitest';

import {
  calculateBackoffDelay,
  createRetryContext,
  DEFAULT_BACKOFF_CONFIG,
  InMemoryRateLimiter,
  NoopRateLimiter,
  shouldRetry,
  withRetry
} from '../src/index.js';

describe('core-rate-limit', () => {
  describe('calculateBackoffDelay', () => {
    it('calculates exponential delay', () => {
      const delay0 = calculateBackoffDelay(0, { jitter: false });
      const delay1 = calculateBackoffDelay(1, { jitter: false });
      const delay2 = calculateBackoffDelay(2, { jitter: false });

      expect(delay0).toBe(1000);
      expect(delay1).toBe(2000);
      expect(delay2).toBe(4000);
    });

    it('respects max delay', () => {
      const delay = calculateBackoffDelay(100, { jitter: false, maxDelayMs: 5000 });
      expect(delay).toBe(5000);
    });

    it('adds jitter when enabled', () => {
      const delays = new Set<number>();
      for (let i = 0; i < 10; i++) {
        delays.add(calculateBackoffDelay(1, { jitter: true }));
      }
      // With jitter, we should get different values
      expect(delays.size).toBeGreaterThan(1);
    });
  });

  describe('shouldRetry', () => {
    it('returns true when under max retries', () => {
      expect(shouldRetry(0, { maxRetries: 3 })).toBe(true);
      expect(shouldRetry(2, { maxRetries: 3 })).toBe(true);
    });

    it('returns false when at or over max retries', () => {
      expect(shouldRetry(3, { maxRetries: 3 })).toBe(false);
      expect(shouldRetry(5, { maxRetries: 3 })).toBe(false);
    });

    it('returns true for infinite retries (maxRetries=0)', () => {
      expect(shouldRetry(100, { maxRetries: 0 })).toBe(true);
    });
  });

  describe('createRetryContext', () => {
    it('creates initial context', () => {
      const ctx = createRetryContext();
      expect(ctx.attempt).toBe(0);
      expect(ctx.totalDelayMs).toBe(0);
      expect(ctx.lastError).toBeUndefined();
    });
  });

  describe('InMemoryRateLimiter', () => {
    let limiter: InMemoryRateLimiter;

    beforeEach(() => {
      limiter = new InMemoryRateLimiter({ limit: 3, windowMs: 60000 });
    });

    it('allows requests within limit', async () => {
      const r1 = await limiter.consume('test-key');
      const r2 = await limiter.consume('test-key');
      const r3 = await limiter.consume('test-key');

      expect(r1.allowed).toBe(true);
      expect(r1.remaining).toBe(2);
      expect(r2.allowed).toBe(true);
      expect(r2.remaining).toBe(1);
      expect(r3.allowed).toBe(true);
      expect(r3.remaining).toBe(0);
    });

    it('rejects requests over limit', async () => {
      await limiter.consume('test-key');
      await limiter.consume('test-key');
      await limiter.consume('test-key');
      const r4 = await limiter.consume('test-key');

      expect(r4.allowed).toBe(false);
      expect(r4.remaining).toBe(0);
      expect(r4.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('checks without consuming', async () => {
      const check1 = await limiter.check('test-key');
      expect(check1.allowed).toBe(true);
      expect(check1.remaining).toBe(3);

      await limiter.consume('test-key');

      const check2 = await limiter.check('test-key');
      expect(check2.allowed).toBe(true);
      expect(check2.remaining).toBe(2);
    });

    it('resets rate limit', async () => {
      await limiter.consume('test-key');
      await limiter.consume('test-key');
      await limiter.reset('test-key');

      const check = await limiter.check('test-key');
      expect(check.remaining).toBe(3);
    });

    it('uses separate windows per key', async () => {
      await limiter.consume('key-a');
      await limiter.consume('key-a');

      const checkA = await limiter.check('key-a');
      const checkB = await limiter.check('key-b');

      expect(checkA.remaining).toBe(1);
      expect(checkB.remaining).toBe(3);
    });
  });

  describe('NoopRateLimiter', () => {
    it('always allows requests', async () => {
      const limiter = new NoopRateLimiter();

      for (let i = 0; i < 100; i++) {
        const result = await limiter.consume('any-key');
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(Infinity);
      }
    });
  });

  describe('withRetry', () => {
    it('returns result on success', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const result = await withRetry(fn);
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries on failure', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValue('success');

      const result = await withRetry(fn, {
        initialDelayMs: 1,
        maxRetries: 3
      });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('throws after max retries', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('always fails'));

      await expect(
        withRetry(fn, {
          initialDelayMs: 1,
          maxRetries: 2
        })
      ).rejects.toThrow('always fails');

      // maxRetries: 2 means 1 initial attempt + 2 retries = 3 total calls
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('respects shouldRetryError', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('non-retryable'));

      await expect(
        withRetry(fn, {
          shouldRetryError: () => false
        })
      ).rejects.toThrow('non-retryable');

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('calls onRetry callback', async () => {
      const onRetry = vi.fn();
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');

      await withRetry(fn, {
        initialDelayMs: 1,
        onRetry
      });

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(
        expect.objectContaining({
          attempt: 1,
          lastError: expect.any(Error)
        })
      );
    });
  });

  describe('DEFAULT_BACKOFF_CONFIG', () => {
    it('has reasonable defaults', () => {
      expect(DEFAULT_BACKOFF_CONFIG.initialDelayMs).toBe(1000);
      expect(DEFAULT_BACKOFF_CONFIG.maxDelayMs).toBe(60000);
      expect(DEFAULT_BACKOFF_CONFIG.multiplier).toBe(2);
      expect(DEFAULT_BACKOFF_CONFIG.maxRetries).toBe(5);
      expect(DEFAULT_BACKOFF_CONFIG.jitter).toBe(true);
    });
  });
});

/**
 * Rate limit status returned by rate limiters.
 */
export interface RateLimitStatus {
  /** Whether the request is allowed */
  allowed: boolean;

  /** Remaining requests in current window */
  remaining: number;

  /** Total limit for current window */
  limit: number;

  /** Time until limit resets (ms) */
  resetInMs: number;

  /** Retry-After header value (seconds), if rate limited */
  retryAfterSeconds?: number;
}

/**
 * Rate limiter interface for controlling API request rates.
 */
export interface RateLimiter {
  /**
   * Check if a request is allowed and consume one token if so.
   * @param key Unique key for rate limiting (e.g., tenant ID, API endpoint)
   */
  consume: (key: string) => Promise<RateLimitStatus>;

  /**
   * Check rate limit status without consuming a token.
   */
  check: (key: string) => Promise<RateLimitStatus>;

  /**
   * Reset rate limit for a key.
   */
  reset: (key: string) => Promise<void>;
}

/**
 * Backoff policy configuration.
 */
export interface BackoffConfig {
  /** Initial delay in milliseconds */
  initialDelayMs: number;

  /** Maximum delay in milliseconds */
  maxDelayMs: number;

  /** Multiplier for exponential backoff */
  multiplier: number;

  /** Maximum number of retries (0 = infinite) */
  maxRetries: number;

  /** Add jitter to prevent thundering herd */
  jitter: boolean;
}

/**
 * Default backoff configuration.
 */
export const DEFAULT_BACKOFF_CONFIG: BackoffConfig = {
  initialDelayMs: 1000,
  maxDelayMs: 60000,
  multiplier: 2,
  maxRetries: 5,
  jitter: true
};

/**
 * Calculate exponential backoff delay.
 */
export function calculateBackoffDelay(attempt: number, config: Partial<BackoffConfig> = {}): number {
  const cfg = { ...DEFAULT_BACKOFF_CONFIG, ...config };
  const delay = Math.min(cfg.initialDelayMs * Math.pow(cfg.multiplier, attempt), cfg.maxDelayMs);

  if (cfg.jitter) {
    // Add ±25% jitter
    const jitterFactor = 0.75 + Math.random() * 0.5;
    return Math.floor(delay * jitterFactor);
  }

  return delay;
}

/**
 * Check if we should retry based on attempt count.
 */
export function shouldRetry(attempt: number, config: Partial<BackoffConfig> = {}): boolean {
  const cfg = { ...DEFAULT_BACKOFF_CONFIG, ...config };
  return cfg.maxRetries === 0 || attempt < cfg.maxRetries;
}

/**
 * Retry context for tracking retry state.
 */
export interface RetryContext {
  attempt: number;
  totalDelayMs: number;
  lastError?: Error;
}

/**
 * Create a new retry context.
 */
export function createRetryContext(): RetryContext {
  return {
    attempt: 0,
    totalDelayMs: 0
  };
}

/**
 * In-memory rate limiter using sliding window algorithm.
 * Suitable for single-instance deployments.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(options: { limit: number; windowMs: number }) {
    this.limit = options.limit;
    this.windowMs = options.windowMs;
  }

  private getWindow(key: string): { count: number; resetAt: number } {
    const now = Date.now();
    const existing = this.windows.get(key);

    if (existing && existing.resetAt > now) {
      return existing;
    }

    const window = { count: 0, resetAt: now + this.windowMs };
    this.windows.set(key, window);
    return window;
  }

  async consume(key: string): Promise<RateLimitStatus> {
    const window = this.getWindow(key);
    const now = Date.now();

    if (window.count >= this.limit) {
      return {
        allowed: false,
        remaining: 0,
        limit: this.limit,
        resetInMs: window.resetAt - now,
        retryAfterSeconds: Math.ceil((window.resetAt - now) / 1000)
      };
    }

    window.count++;

    return {
      allowed: true,
      remaining: this.limit - window.count,
      limit: this.limit,
      resetInMs: window.resetAt - now
    };
  }

  async check(key: string): Promise<RateLimitStatus> {
    const window = this.getWindow(key);
    const now = Date.now();

    return {
      allowed: window.count < this.limit,
      remaining: Math.max(0, this.limit - window.count),
      limit: this.limit,
      resetInMs: window.resetAt - now,
      retryAfterSeconds: window.count >= this.limit ? Math.ceil((window.resetAt - now) / 1000) : undefined
    };
  }

  async reset(key: string): Promise<void> {
    this.windows.delete(key);
  }

  /** Clear all windows (for testing) */
  clear(): void {
    this.windows.clear();
  }
}

/**
 * No-op rate limiter that always allows requests.
 * Useful for testing or when rate limiting is handled externally.
 */
export class NoopRateLimiter implements RateLimiter {
  async consume(_key: string): Promise<RateLimitStatus> {
    return {
      allowed: true,
      remaining: Infinity,
      limit: Infinity,
      resetInMs: 0
    };
  }

  async check(_key: string): Promise<RateLimitStatus> {
    return {
      allowed: true,
      remaining: Infinity,
      limit: Infinity,
      resetInMs: 0
    };
  }

  async reset(_key: string): Promise<void> {
    // No-op
  }
}

/**
 * Sleep for a given duration.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with exponential backoff on failure.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<BackoffConfig> & {
    shouldRetryError?: (error: Error) => boolean;
    onRetry?: (context: RetryContext) => void;
  } = {}
): Promise<T> {
  const ctx = createRetryContext();
  const shouldRetryError = options.shouldRetryError ?? (() => true);

  while (true) {
    try {
      return await fn();
    } catch (error) {
      const err = error as Error;
      ctx.lastError = err;

      if (!shouldRetryError(err) || !shouldRetry(ctx.attempt, options)) {
        throw err;
      }

      const delay = calculateBackoffDelay(ctx.attempt, options);
      ctx.totalDelayMs += delay;
      ctx.attempt++;

      options.onRetry?.(ctx);

      await sleep(delay);
    }
  }
}

import { z } from 'zod';

/**
 * Token information schema for OAuth-style tokens.
 */
export const TokenInfoSchema = z.object({
  /** Access token for API calls */
  accessToken: z.string().min(1),

  /** Token type (usually 'Bearer') */
  tokenType: z.string().default('Bearer'),

  /** Expiration timestamp (ISO-8601) */
  expiresAt: z.string().datetime().optional(),

  /** Refresh token for obtaining new access tokens */
  refreshToken: z.string().optional(),

  /** Scopes granted to this token */
  scopes: z.array(z.string()).default([]),

  /** Provider-specific metadata */
  meta: z.record(z.unknown()).optional()
});
export type TokenInfo = z.infer<typeof TokenInfoSchema>;

/**
 * Token storage key components for multi-tenant scenarios.
 */
export interface TokenStorageKey {
  /** Connector identifier (e.g., 'instagram', 'whatsapp') */
  connector: string;

  /** Tenant identifier */
  tenantId: string;

  /** Optional account/page/channel identifier within tenant */
  accountId?: string;
}

/**
 * Interface for token storage backends.
 * Implementations can use memory, Redis, database, etc.
 */
export interface TokenStorage {
  /**
   * Retrieve token info for a given key.
   * Returns undefined if not found.
   */
  get: (key: TokenStorageKey) => Promise<TokenInfo | undefined>;

  /**
   * Store token info for a given key.
   */
  set: (key: TokenStorageKey, token: TokenInfo) => Promise<void>;

  /**
   * Delete token info for a given key.
   */
  delete: (key: TokenStorageKey) => Promise<void>;

  /**
   * Check if a token exists for a given key.
   */
  exists: (key: TokenStorageKey) => Promise<boolean>;
}

/**
 * In-memory token storage for testing and development.
 */
export class InMemoryTokenStorage implements TokenStorage {
  private readonly store = new Map<string, TokenInfo>();

  private keyToString(key: TokenStorageKey): string {
    return `${key.connector}:${key.tenantId}:${key.accountId ?? '_default'}`;
  }

  async get(key: TokenStorageKey): Promise<TokenInfo | undefined> {
    return this.store.get(this.keyToString(key));
  }

  async set(key: TokenStorageKey, token: TokenInfo): Promise<void> {
    this.store.set(this.keyToString(key), token);
  }

  async delete(key: TokenStorageKey): Promise<void> {
    this.store.delete(this.keyToString(key));
  }

  async exists(key: TokenStorageKey): Promise<boolean> {
    return this.store.has(this.keyToString(key));
  }

  /** Clear all stored tokens (for testing) */
  clear(): void {
    this.store.clear();
  }
}

/**
 * Check if a token is expired or about to expire.
 * @param token Token info to check
 * @param bufferMs Buffer time in milliseconds before actual expiration (default: 5 minutes)
 */
export function isTokenExpired(token: TokenInfo, bufferMs = 5 * 60 * 1000): boolean {
  if (!token.expiresAt) {
    return false; // No expiration means it doesn't expire
  }

  const expiresAt = new Date(token.expiresAt).getTime();
  const now = Date.now();
  return now >= expiresAt - bufferMs;
}

/**
 * Check if a token can be refreshed.
 */
export function canRefreshToken(token: TokenInfo): boolean {
  return !!token.refreshToken;
}

/**
 * Parse and validate token info.
 */
export function parseTokenInfo(data: unknown): TokenInfo {
  return TokenInfoSchema.parse(data);
}

/**
 * Create a token info object with calculated expiration.
 */
export function createTokenInfo(
  accessToken: string,
  options?: {
    expiresInSeconds?: number;
    refreshToken?: string;
    scopes?: string[];
    tokenType?: string;
    meta?: Record<string, unknown>;
  }
): TokenInfo {
  const expiresAt = options?.expiresInSeconds
    ? new Date(Date.now() + options.expiresInSeconds * 1000).toISOString()
    : undefined;

  return {
    accessToken,
    tokenType: options?.tokenType ?? 'Bearer',
    expiresAt,
    refreshToken: options?.refreshToken,
    scopes: options?.scopes ?? [],
    meta: options?.meta
  };
}

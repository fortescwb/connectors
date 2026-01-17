/**
 * @connectors/core-runtime
 *
 * Provides a unified runtime for connectors that centralizes:
 * - CorrelationId management
 * - Signature verification (pluggable)
 * - Deduplication
 * - Rate limiting
 * - Structured logging
 * - Capability → handler mapping
 */

import type { ConnectorManifest, CapabilityId } from '@connectors/core-connectors';
import { createLogger, type Logger, type LoggerContext } from '@connectors/core-logging';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES: Requests and Responses
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generic request shape for webhook handlers.
 * Compatible with Express-like adapters.
 */
export interface RuntimeRequest {
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | undefined>;
  body: unknown;
  rawBody?: Buffer | string;
}

/**
 * Generic response shape returned by webhook handlers.
 */
export interface RuntimeResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
  contentType?: 'application/json' | 'text/plain';
}

/**
 * Standard success response body.
 */
export interface SuccessResponseBody {
  ok: true;
  deduped: boolean;
  correlationId: string;
}

/**
 * Standard error response body.
 */
export interface ErrorResponseBody {
  ok: false;
  code: string;
  message: string;
  correlationId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPES: Runtime Context
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Context passed to capability handlers during request processing.
 */
export interface RuntimeContext {
  correlationId: string;
  connector: string;
  tenant?: string;
  deduped: boolean;
  logger: Logger;
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPES: Capability Handlers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A handler for a specific capability.
 * Receives the parsed event and runtime context.
 */
export type CapabilityHandler<TEvent = unknown> = (
  event: TEvent,
  ctx: RuntimeContext
) => Promise<void>;

/**
 * Registry mapping capability IDs to their handlers.
 */
export type CapabilityRegistry = Partial<Record<CapabilityId, CapabilityHandler>>;

// ─────────────────────────────────────────────────────────────────────────────
// TYPES: Signature Verification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of signature verification.
 */
export interface SignatureResult {
  valid: boolean;
  code?: 'INVALID_SIGNATURE' | 'MISSING_SIGNATURE' | 'MISSING_RAW_BODY';
}

/**
 * Pluggable signature verifier interface.
 */
export interface SignatureVerifier {
  /**
   * Verify request signature.
   * @param request The incoming request with rawBody
   * @returns Verification result
   */
  verify: (request: RuntimeRequest) => SignatureResult | Promise<SignatureResult>;

  /**
   * Whether signature verification is enabled (e.g., secret is configured).
   */
  enabled: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPES: Deduplication
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Interface for deduplication storage.
 */
export interface DedupeStore {
  /**
   * Check if a key is duplicate and mark it as seen atomically.
   * @param key Unique event identifier
   * @param ttlMs Time-to-live for the key
   * @returns true if already seen (duplicate), false otherwise
   */
  checkAndMark: (key: string, ttlMs: number) => Promise<boolean>;
}

/**
 * In-memory deduplication store with TTL.
 * Suitable for single-instance deployments or testing.
 */
export class InMemoryDedupeStore implements DedupeStore {
  private readonly store = new Map<string, number>();

  async checkAndMark(key: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const expiresAt = this.store.get(key);

    if (expiresAt && expiresAt > now) {
      return true; // Already seen
    }

    this.store.set(key, now + ttlMs);
    setTimeout(() => this.store.delete(key), ttlMs).unref?.();
    return false;
  }
}

/**
 * No-op deduplication store that never deduplicates.
 */
export class NoopDedupeStore implements DedupeStore {
  async checkAndMark(_key: string, _ttlMs: number): Promise<boolean> {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPES: Rate Limiting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of rate limit check.
 */
export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs?: number;
}

/**
 * Pluggable rate limiter interface.
 */
export interface RateLimiter {
  /**
   * Consume rate limit quota.
   * @param key Rate limit key (e.g., tenant, IP)
   * @param cost Cost of this request (default: 1)
   * @returns Whether the request is allowed
   */
  consume: (key: string, cost?: number) => Promise<RateLimitResult>;
}

/**
 * No-op rate limiter that always allows requests.
 */
export class NoopRateLimiter implements RateLimiter {
  async consume(_key: string, _cost?: number): Promise<RateLimitResult> {
    return { allowed: true };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPES: Event Parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parsed event with dedupe key and optional correlation ID.
 */
export interface ParsedEvent<TPayload = unknown> {
  capabilityId: CapabilityId;
  dedupeKey: string;
  correlationId?: string;
  tenant?: string;
  payload: TPayload;
}

/**
 * Event parser function.
 */
export type EventParser<TPayload = unknown> = (
  request: RuntimeRequest
) => ParsedEvent<TPayload> | Promise<ParsedEvent<TPayload>>;

// ─────────────────────────────────────────────────────────────────────────────
// TYPES: Webhook Verification (GET)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of webhook GET verification.
 */
export interface WebhookVerifyResult {
  success: boolean;
  challenge?: string;
  errorCode?: 'FORBIDDEN' | 'SERVICE_UNAVAILABLE';
  errorMessage?: string;
}

/**
 * Handler for webhook verification (GET requests).
 */
export type WebhookVerifyHandler = (
  query: Record<string, string | undefined>
) => WebhookVerifyResult | Promise<WebhookVerifyResult>;

// ─────────────────────────────────────────────────────────────────────────────
// TYPES: Runtime Configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configuration for creating a connector runtime.
 */
export interface RuntimeConfig<TPayload = unknown> {
  manifest: ConnectorManifest;
  registry: CapabilityRegistry;

  /**
   * Parse incoming request into a normalized event.
   */
  parseEvent: EventParser<TPayload>;

  /**
   * Handle GET verification requests.
   */
  verifyWebhook?: WebhookVerifyHandler;

  /**
   * Signature verification (optional).
   */
  signatureVerifier?: SignatureVerifier;

  /**
   * Deduplication store.
   * @default InMemoryDedupeStore
   */
  dedupeStore?: DedupeStore;

  /**
   * Dedupe TTL in milliseconds.
   * @default 300000 (5 minutes)
   */
  dedupeTtlMs?: number;

  /**
   * Rate limiter (optional).
   */
  rateLimiter?: RateLimiter;

  /**
   * Logger instance.
   */
  logger?: Logger;
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPES: Webhook Handlers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handlers for GET and POST webhook requests.
 */
export interface WebhookHandlers {
  handleGet: (request: RuntimeRequest) => Promise<RuntimeResponse>;
  handlePost: (request: RuntimeRequest) => Promise<RuntimeResponse>;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_DEDUPE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a unique correlation ID.
 */
export function generateCorrelationId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Extract correlationId from headers.
 */
function extractCorrelationIdFromHeaders(
  headers: Record<string, string | string[] | undefined>
): string | undefined {
  const headerValue = headers['x-correlation-id'];
  if (typeof headerValue === 'string') {
    return headerValue;
  }
  if (Array.isArray(headerValue) && headerValue.length > 0) {
    return headerValue[0];
  }
  return undefined;
}

/**
 * Build standard response headers.
 */
function buildResponseHeaders(correlationId: string): Record<string, string> {
  return { 'x-correlation-id': correlationId };
}

/**
 * Create an error response.
 */
function errorResponse(
  status: number,
  code: string,
  message: string,
  correlationId: string
): RuntimeResponse {
  return {
    status,
    body: { ok: false, code, message, correlationId } satisfies ErrorResponseBody,
    headers: buildResponseHeaders(correlationId)
  };
}

/**
 * Create a success response.
 */
function successResponse(correlationId: string, deduped: boolean): RuntimeResponse {
  return {
    status: 200,
    body: { ok: true, deduped, correlationId } satisfies SuccessResponseBody,
    headers: buildResponseHeaders(correlationId)
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONNECTOR RUNTIME
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Connector runtime instance.
 */
export interface ConnectorRuntime {
  readonly manifest: ConnectorManifest;
  readonly handlers: WebhookHandlers;
}

/**
 * Create a connector runtime with unified webhook handling.
 */
export function createConnectorRuntime<TPayload = unknown>(
  config: RuntimeConfig<TPayload>
): ConnectorRuntime {
  const handlers = buildWebhookHandlers(config);
  return {
    manifest: config.manifest,
    handlers
  };
}

/**
 * Build GET and POST webhook handlers from runtime configuration.
 */
export function buildWebhookHandlers<TPayload = unknown>(
  config: RuntimeConfig<TPayload>
): WebhookHandlers {
  const {
    manifest,
    registry,
    parseEvent,
    verifyWebhook,
    signatureVerifier,
    dedupeStore = new InMemoryDedupeStore(),
    dedupeTtlMs = DEFAULT_DEDUPE_TTL_MS,
    rateLimiter
  } = config;

  // ─────────────────────────────────────────────────────────────────────────
  // GET Handler (Webhook Verification)
  // ─────────────────────────────────────────────────────────────────────────

  const handleGet = async (request: RuntimeRequest): Promise<RuntimeResponse> => {
    // GET always generates new correlationId (ignores header per contract)
    const correlationId = generateCorrelationId();
    const logger = createLogger({
      service: manifest.id,
      correlationId,
      connector: manifest.id
    } as LoggerContext);

    if (!verifyWebhook) {
      logger.error('Webhook verification handler not configured');
      return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Webhook verification not configured', correlationId);
    }

    try {
      const result = await verifyWebhook(request.query);

      if (result.success) {
        logger.info('Webhook verification successful');
        return {
          status: 200,
          body: result.challenge ?? '',
          headers: buildResponseHeaders(correlationId),
          contentType: 'text/plain'
        };
      }

      const status = result.errorCode === 'SERVICE_UNAVAILABLE' ? 503 : 403;
      logger.warn('Webhook verification failed', { code: result.errorCode });
      return errorResponse(status, result.errorCode ?? 'FORBIDDEN', result.errorMessage ?? 'Verification failed', correlationId);
    } catch (error) {
      const err = error as Error;
      logger.error('Webhook verification error', { error: err.message });
      return errorResponse(500, 'INTERNAL_ERROR', 'internal_error', correlationId);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // POST Handler (Event Processing)
  // ─────────────────────────────────────────────────────────────────────────

  const handlePost = async (request: RuntimeRequest): Promise<RuntimeResponse> => {
    // Step 1: Determine correlationId (fallback for early errors)
    const headerCorrelationId = extractCorrelationIdFromHeaders(request.headers);
    const fallbackCorrelationId = headerCorrelationId ?? generateCorrelationId();

    // Step 2: Validate rawBody requirement for signature
    if (signatureVerifier?.enabled) {
      if (!request.rawBody) {
        const logger = createLogger({
          service: manifest.id,
          correlationId: fallbackCorrelationId,
          connector: manifest.id
        } as LoggerContext);
        logger.error('rawBody required for signature verification but not provided');
        return errorResponse(
          500,
          'INTERNAL_ERROR',
          'rawBody required for signature verification',
          fallbackCorrelationId
        );
      }

      // Step 3: Verify signature
      const signatureResult = await signatureVerifier.verify(request);
      if (!signatureResult.valid) {
        const logger = createLogger({
          service: manifest.id,
          correlationId: fallbackCorrelationId,
          connector: manifest.id
        } as LoggerContext);
        // Log only metadata, not payload, when signature fails
        logger.warn('Signature verification failed', { code: signatureResult.code });
        return errorResponse(401, 'UNAUTHORIZED', 'Invalid signature', fallbackCorrelationId);
      }
    }

    // Step 4: Parse event
    let event: ParsedEvent<TPayload>;
    try {
      event = await parseEvent(request);
    } catch (error) {
      const err = error as Error;
      const logger = createLogger({
        service: manifest.id,
        correlationId: fallbackCorrelationId,
        connector: manifest.id
      } as LoggerContext);
      logger.warn('Event parsing failed', { error: err.message });
      return errorResponse(400, 'WEBHOOK_VALIDATION_FAILED', err.message, fallbackCorrelationId);
    }

    // Step 5: Determine final correlationId (event > header > generated)
    const correlationId = event.correlationId ?? fallbackCorrelationId;

    const logger = createLogger({
      service: manifest.id,
      correlationId,
      connector: manifest.id,
      ...(event.tenant && { tenantId: event.tenant })
    } as LoggerContext);

    // Step 6: Rate limiting
    if (rateLimiter) {
      const rateLimitKey = event.tenant ?? manifest.id;
      const rateLimitResult = await rateLimiter.consume(rateLimitKey);

      if (!rateLimitResult.allowed) {
        const retryAfterSeconds = rateLimitResult.retryAfterMs
          ? Math.ceil(rateLimitResult.retryAfterMs / 1000)
          : 60;

        logger.warn('Rate limit exceeded', { retryAfterSeconds });
        return {
          status: 429,
          body: {
            ok: false,
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests',
            correlationId
          } satisfies ErrorResponseBody,
          headers: {
            ...buildResponseHeaders(correlationId),
            'Retry-After': String(retryAfterSeconds)
          }
        };
      }
    }

    // Step 7: Deduplication
    const isDuplicate = await dedupeStore.checkAndMark(event.dedupeKey, dedupeTtlMs);

    const ctx: RuntimeContext = {
      correlationId,
      connector: manifest.id,
      tenant: event.tenant,
      deduped: isDuplicate,
      logger
    };

    if (isDuplicate) {
      logger.info('Duplicate event skipped', { dedupeKey: event.dedupeKey, deduped: true });
      return successResponse(correlationId, true);
    }

    // Step 8: Find and execute handler
    const handler = registry[event.capabilityId];
    if (!handler) {
      logger.error('No handler registered for capability', { capabilityId: event.capabilityId });
      return errorResponse(500, 'INTERNAL_ERROR', `No handler for capability: ${event.capabilityId}`, correlationId);
    }

    try {
      await handler(event.payload, ctx);
      logger.info('Event processed successfully', { dedupeKey: event.dedupeKey, deduped: false });
      return successResponse(correlationId, false);
    } catch (error) {
      const err = error as Error;
      logger.error('Handler execution failed', { error: err.message, stack: err.stack });
      return errorResponse(500, 'INTERNAL_ERROR', 'internal_error', correlationId);
    }
  };

  return { handleGet, handlePost };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export { DEFAULT_DEDUPE_TTL_MS };

// Re-export Redis DedupeStore for distributed environments
export {
  RedisDedupeStore,
  createRedisDedupeStore,
  type RedisClient,
  type RedisDedupeStoreOptions
} from './redis-dedupe-store.js';

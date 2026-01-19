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
import { DEFAULT_DEDUPE_TTL_MS } from './constants.js';

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
  correlationId: string;
  /**
   * True only when ALL items in the batch were deduplicated (no processing, no failures).
   * For per-item status, see results[].deduped (boolean).
   * For count, see summary.deduped (number).
   */
  fullyDeduped: boolean;
  summary: BatchSummary;
  results?: BatchItemResult[];
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

/**
 * Per-item result returned in batch responses.
 */
export interface BatchItemResult {
  capabilityId: CapabilityId;
  dedupeKey: string;
  ok: boolean;
  deduped: boolean;
  correlationId: string;
  latencyMs?: number;
  errorCode?: string;
}

/**
 * Summary of batch processing.
 */
export interface BatchSummary {
  total: number;
  processed: number;
  deduped: number;
  failed: number;
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
  dedupeKey: string;
  capabilityId: CapabilityId;
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

/**
 * Batch event parser function (preferred).
 */
export type EventBatchParser<TPayload = unknown> = (
  request: RuntimeRequest
) => ParsedEvent<TPayload>[] | Promise<ParsedEvent<TPayload>[]>;

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
   * Parse incoming request into a normalized batch of events (preferred).
   */
  parseEvents?: EventBatchParser<TPayload>;

  /**
   * Legacy single-event parser (deprecated, kept for compatibility).
   */
  parseEvent?: EventParser<TPayload>;

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
/**
 * Generate a unique correlation ID.
 */
export function generateCorrelationId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 11)}`;
}

type RuntimeMetric =
  | 'webhook_received_total'
  | 'event_processed_total'
  | 'event_deduped_total'
  | 'event_failed_total'
  | 'handler_latency_ms'
  | 'event_batch_summary';

function emitMetric(logger: Logger, metric: RuntimeMetric, value: number, context?: LoggerContext) {
  logger.info('metric', { metric, value, ...context });
}

function computeLatencyMs(startedAt: number): number {
  return Date.now() - startedAt;
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
 * Create a batch success response with summary.
 */
function successBatchResponse(
  correlationId: string,
  summary: BatchSummary,
  results?: BatchItemResult[]
): RuntimeResponse {
  const fullyDeduped = summary.total > 0 && summary.deduped === summary.total && summary.failed === 0 && summary.processed === 0;
  return {
    status: 200,
    body: {
      ok: true,
      fullyDeduped,
      correlationId,
      summary,
      ...(results && results.length > 0 ? { results } : {})
    } satisfies SuccessResponseBody,
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
    parseEvents,
    parseEvent,
    verifyWebhook,
    signatureVerifier,
    dedupeStore = new InMemoryDedupeStore(),
    dedupeTtlMs = DEFAULT_DEDUPE_TTL_MS,
    rateLimiter,
    logger
  } = config;

  const baseLogContext: LoggerContext = { service: manifest.id, connector: manifest.id };
  const buildScopedLogger = (context: LoggerContext): Logger => {
    const merged = { ...baseLogContext, ...context };

    if (logger) {
      return {
        info: (message, extra) => logger.info(message, { ...merged, ...extra }),
        warn: (message, extra) => logger.warn(message, { ...merged, ...extra }),
        error: (message, extra) => logger.error(message, { ...merged, ...extra })
      };
    }

    return createLogger(merged);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // GET Handler (Webhook Verification)
  // ─────────────────────────────────────────────────────────────────────────

  const handleGet = async (request: RuntimeRequest): Promise<RuntimeResponse> => {
    // GET always generates new correlationId (ignores header per contract)
    const correlationId = generateCorrelationId();
    const scopedLogger = buildScopedLogger({ correlationId });

    if (!verifyWebhook) {
      scopedLogger.error('Webhook verification handler not configured');
      return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Webhook verification not configured', correlationId);
    }

    try {
      const result = await verifyWebhook(request.query);

      if (result.success) {
        scopedLogger.info('Webhook verification successful');
        return {
          status: 200,
          body: result.challenge ?? '',
          headers: buildResponseHeaders(correlationId),
          contentType: 'text/plain'
        };
      }

      const status = result.errorCode === 'SERVICE_UNAVAILABLE' ? 503 : 403;
      scopedLogger.warn('Webhook verification failed', { code: result.errorCode });
      return errorResponse(status, result.errorCode ?? 'FORBIDDEN', result.errorMessage ?? 'Verification failed', correlationId);
    } catch (error) {
      const err = error as Error;
      scopedLogger.error('Webhook verification error', { error: err.message });
      return errorResponse(500, 'INTERNAL_ERROR', 'internal_error', correlationId);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // POST Handler (Event Processing)
  // ─────────────────────────────────────────────────────────────────────────

  const handlePost = async (request: RuntimeRequest): Promise<RuntimeResponse> => {
    const headerCorrelationId = extractCorrelationIdFromHeaders(request.headers);
    const fallbackCorrelationId = headerCorrelationId ?? generateCorrelationId();
    const parser = async () => {
      if (parseEvents) {
        return parseEvents(request);
      }
      if (parseEvent) {
        const single = await parseEvent(request);
        return [single];
      }
      throw new Error('No parser configured (parseEvents or parseEvent required)');
    };
    const buildErrorLogger = (correlationId: string, tenant?: string) =>
      buildScopedLogger({ correlationId, ...(tenant && { tenantId: tenant }) } as LoggerContext);

    // Step 1: Validate rawBody requirement for signature
    if (signatureVerifier?.enabled) {
      if (!request.rawBody) {
        const scopedLogger = buildErrorLogger(fallbackCorrelationId);
        scopedLogger.error('rawBody required for signature verification but not provided');
        return errorResponse(
          500,
          'INTERNAL_ERROR',
          'rawBody required for signature verification',
          fallbackCorrelationId
        );
      }

      // Step 2: Verify signature (once per request)
      const signatureResult = await signatureVerifier.verify(request);
      if (!signatureResult.valid) {
        const scopedLogger = buildErrorLogger(fallbackCorrelationId);
        scopedLogger.warn('Signature verification failed', { code: signatureResult.code });
        return errorResponse(401, 'UNAUTHORIZED', 'Invalid signature', fallbackCorrelationId);
      }
    }

    // Step 3: Parse batch of events
    let events: ParsedEvent<TPayload>[];
    try {
      const parsed = await parser();
      events = Array.isArray(parsed) ? parsed : [parsed];
    } catch (error) {
      const err = error as Error;
      const scopedLogger = buildErrorLogger(fallbackCorrelationId);
      scopedLogger.warn('Event parsing failed', { error: err.message });
      const statusCode = err.message.includes('No parser configured') ? 500 : 400;
      const code = statusCode === 500 ? 'INTERNAL_ERROR' : 'WEBHOOK_VALIDATION_FAILED';
      return errorResponse(statusCode, code, err.message, fallbackCorrelationId);
    }

    if (events.length === 0) {
      const scopedLogger = buildErrorLogger(fallbackCorrelationId);
      scopedLogger.warn('Event parsing returned empty batch');
      return errorResponse(400, 'WEBHOOK_VALIDATION_FAILED', 'No events parsed from request', fallbackCorrelationId);
    }

    // Step 4: Determine final correlationId (batch-level)
    const correlationId = events[0]?.correlationId ?? fallbackCorrelationId;
    const summaryCapabilityId =
      events.length > 0 && events.every((evt) => evt.capabilityId === events[0]?.capabilityId)
        ? events[0]!.capabilityId
        : 'mixed';
    const summary: BatchSummary = { total: events.length, processed: 0, deduped: 0, failed: 0 };
    const results: BatchItemResult[] = [];

    // Step 5: Rate limiting (once per request, cost = batch size)
    if (rateLimiter) {
      const rateLimitKey = events[0]?.tenant ?? manifest.id;
      const rateLimitResult = await rateLimiter.consume(rateLimitKey, events.length);

      if (!rateLimitResult.allowed) {
        const retryAfterSeconds = rateLimitResult.retryAfterMs
          ? Math.ceil(rateLimitResult.retryAfterMs / 1000)
          : 60;

        const scopedLogger = buildErrorLogger(correlationId, events[0]?.tenant);
        scopedLogger.warn('Rate limit exceeded', { retryAfterSeconds });
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

    // Step 6: Process each event sequentially for deterministic logging
    for (const event of events) {
      const eventCorrelationId = event.correlationId ?? correlationId;
      const eventLogger = buildScopedLogger({
        correlationId: eventCorrelationId,
        capabilityId: event.capabilityId,
        dedupeKey: event.dedupeKey,
        ...(event.tenant && { tenantId: event.tenant })
      } as LoggerContext);
      const ctx: RuntimeContext = {
        correlationId: eventCorrelationId,
        connector: manifest.id,
        tenant: event.tenant,
        deduped: false,
        dedupeKey: event.dedupeKey,
        capabilityId: event.capabilityId,
        logger: eventLogger
      };

      const handler = registry[event.capabilityId];
      const startedAt = Date.now();

      emitMetric(eventLogger, 'webhook_received_total', 1, { outcome: 'received' });

      const isDuplicate = await dedupeStore.checkAndMark(event.dedupeKey, dedupeTtlMs);

      if (isDuplicate) {
        const latencyMs = computeLatencyMs(startedAt);
        summary.deduped += 1;
        ctx.deduped = true;
        eventLogger.info('Duplicate event skipped', {
          dedupeKey: event.dedupeKey,
          deduped: true,
          outcome: 'deduped',
          latencyMs
        });
        emitMetric(eventLogger, 'event_deduped_total', 1, { outcome: 'deduped', latencyMs });
        emitMetric(eventLogger, 'handler_latency_ms', latencyMs, { outcome: 'deduped' });
        results.push({
          capabilityId: event.capabilityId,
          dedupeKey: event.dedupeKey,
          ok: true,
          deduped: true,
          correlationId: eventCorrelationId,
          latencyMs
        });
        continue;
      }

      if (!handler) {
        const latencyMs = computeLatencyMs(startedAt);
        summary.failed += 1;
        eventLogger.warn('No handler registered for capability', {
          deduped: false,
          outcome: 'failed',
          errorCode: 'NO_HANDLER',
          latencyMs
        });
        emitMetric(eventLogger, 'event_failed_total', 1, {
          outcome: 'failed',
          errorCode: 'NO_HANDLER',
          latencyMs
        });
        emitMetric(eventLogger, 'handler_latency_ms', latencyMs, { outcome: 'failed' });
        results.push({
          capabilityId: event.capabilityId,
          dedupeKey: event.dedupeKey,
          ok: false,
          deduped: false,
          correlationId: eventCorrelationId,
          latencyMs,
          errorCode: 'NO_HANDLER'
        });
        continue;
      }

      try {
        await handler(event.payload, ctx);
        const latencyMs = computeLatencyMs(startedAt);
        summary.processed += 1;
        eventLogger.info('Event processed successfully', {
          dedupeKey: event.dedupeKey,
          deduped: false,
          outcome: 'processed',
          latencyMs
        });
        emitMetric(eventLogger, 'event_processed_total', 1, { outcome: 'processed', latencyMs });
        emitMetric(eventLogger, 'handler_latency_ms', latencyMs, { outcome: 'processed' });
        results.push({
          capabilityId: event.capabilityId,
          dedupeKey: event.dedupeKey,
          ok: true,
          deduped: false,
          correlationId: eventCorrelationId,
          latencyMs
        });
      } catch (error) {
        const err = error as Error;
        const latencyMs = computeLatencyMs(startedAt);
        summary.failed += 1;
        eventLogger.error('Handler execution failed', {
          error: err.message,
          dedupeKey: event.dedupeKey,
          deduped: false,
          outcome: 'failed',
          latencyMs,
          errorCode: 'HANDLER_FAILED'
        });
        emitMetric(eventLogger, 'event_failed_total', 1, {
          outcome: 'failed',
          errorCode: 'HANDLER_FAILED',
          latencyMs
        });
        emitMetric(eventLogger, 'handler_latency_ms', latencyMs, { outcome: 'failed' });
        results.push({
          capabilityId: event.capabilityId,
          dedupeKey: event.dedupeKey,
          ok: false,
          deduped: false,
          correlationId: eventCorrelationId,
          latencyMs,
          errorCode: 'HANDLER_FAILED'
        });
      }
    }

    const summaryLogger = buildScopedLogger({ correlationId, capabilityId: summaryCapabilityId } as LoggerContext);
    summaryLogger.info('Inbound batch summary', {
      metric: 'event_batch_summary',
      outcome: 'summary',
      capabilityId: summaryCapabilityId,
      total: summary.total,
      processed: summary.processed,
      deduped: summary.deduped,
      failed: summary.failed
    });
    emitMetric(summaryLogger, 'event_batch_summary', summary.total, {
      capabilityId: summaryCapabilityId,
      processed: summary.processed,
      deduped: summary.deduped,
      failed: summary.failed
    });

    // Always return 200 for a valid batch, even with partial failures
    return successBatchResponse(correlationId, summary, results);
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

// Outbound runtime (exactly-once side-effects)
export type {
  OutboundBatchResult,
  OutboundIntent,
  OutboundItemResult,
  OutboundItemStatus,
  OutboundRuntimeOptions,
  OutboundSendContext,
  OutboundSendFn
} from './outbound/types.js';
export { processOutboundBatch } from './outbound/processOutboundBatch.js';

import type { EventEnvelope } from '@connectors/core-events';
import { createLogger, type Logger } from '@connectors/core-logging';
import { ValidationError } from '@connectors/core-validation';

export type WebhookContext = {
  tenantId: EventEnvelope['tenantId'];
  correlationId?: string;
  logger: Logger;
};

export type WebhookRequest = {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  rawBody?: Buffer | string;
};

export type WebhookResponse = {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
};

export type WebhookOptions = {
  serviceName: string;
  parseEvent: (input: WebhookRequest) => EventEnvelope | Promise<EventEnvelope>;
  onEvent: (event: EventEnvelope, ctx: WebhookContext) => Promise<void>;
  dedupeTtlMs?: number;
  logger?: Logger;
  dedupeStore?: DedupeStore;
};

/**
 * Interface for deduplication storage.
 * All methods are async to support both in-memory and distributed stores.
 */
export interface DedupeStore {
  /**
   * Check if a key is a duplicate and mark it as seen.
   * Returns true if the key was already seen (duplicate), false otherwise.
   */
  isDuplicate: (key: string) => Promise<boolean>;
}

/**
 * In-memory deduplication store with TTL.
 * Suitable for single-instance deployments or testing.
 */
export class InMemoryDedupeStore implements DedupeStore {
  private readonly store = new Map<string, number>();
  private readonly ttlMs: number;

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  async isDuplicate(key: string): Promise<boolean> {
    const now = Date.now();
    const expiresAt = this.store.get(key);
    if (expiresAt && expiresAt > now) {
      return true;
    }

    this.store.set(key, now + this.ttlMs);
    setTimeout(() => this.store.delete(key), this.ttlMs).unref?.();
    return false;
  }
}

/**
 * No-op deduplication store that never deduplicates.
 * Use when idempotency is handled upstream or not needed.
 */
export class NoopDedupeStore implements DedupeStore {
  async isDuplicate(_key: string): Promise<boolean> {
    return false;
  }
}

const DEFAULT_DEDUPE_TTL_MS = 5 * 60 * 1000;

function generateCorrelationId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Extract correlationId from headers (handles string or string[] values).
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

export function createWebhookProcessor(options: WebhookOptions) {
  const baseLogger = options.logger ?? createLogger({ service: options.serviceName });
  const dedupeStore =
    options.dedupeStore ?? new InMemoryDedupeStore(options.dedupeTtlMs ?? DEFAULT_DEDUPE_TTL_MS);

  return async (input: WebhookRequest): Promise<WebhookResponse> => {
    // Extract correlationId from headers first, then generate fallback
    const headerCorrelationId = extractCorrelationIdFromHeaders(input.headers);
    const fallbackCorrelationId = headerCorrelationId ?? generateCorrelationId();

    try {
      const event = await options.parseEvent(input);
      // Prefer event correlationId, then header, then generated
      const correlationId = event.correlationId ?? fallbackCorrelationId;

      const logger = createLogger({
        service: options.serviceName,
        tenantId: event.tenantId,
        correlationId,
        eventId: event.eventId,
        eventType: event.eventType
      });

      const deduped = await dedupeStore.isDuplicate(event.dedupeKey);
      const dedupeLogFields = { deduped, dedupeKey: event.dedupeKey };
      const responseHeaders = { 'x-correlation-id': correlationId };

      if (deduped) {
        logger.info('Duplicate webhook event skipped', dedupeLogFields);
        return {
          status: 200,
          body: { ok: true, deduped: true, correlationId },
          headers: responseHeaders
        };
      }

      const ctx: WebhookContext = {
        tenantId: event.tenantId,
        correlationId,
        logger
      };

      await options.onEvent(event, ctx);

      logger.info('Webhook event processed', { ...dedupeLogFields, deduped: false });
      return {
        status: 200,
        body: { ok: true, deduped: false, correlationId },
        headers: responseHeaders
      };
    } catch (error) {
      const err = error as HttpError;
      const responseHeaders = { 'x-correlation-id': fallbackCorrelationId };

      if (err instanceof ValidationError) {
        baseLogger.warn('Webhook validation failed', { error: err.message, correlationId: fallbackCorrelationId });
        return {
          status: 400,
          body: { ok: false, code: 'WEBHOOK_VALIDATION_FAILED', message: err.message, correlationId: fallbackCorrelationId },
          headers: responseHeaders
        };
      }

      if (err.status === 401 || err.statusCode === 401) {
        baseLogger.warn('Unauthorized webhook request', { error: err.message, correlationId: fallbackCorrelationId });
        return {
          status: 401,
          body: { ok: false, code: 'UNAUTHORIZED', message: 'unauthorized', correlationId: fallbackCorrelationId },
          headers: responseHeaders
        };
      }

      baseLogger.error('Webhook handler failed', {
        error: err.message,
        stack: err.stack,
        correlationId: fallbackCorrelationId
      });
      return {
        status: 500,
        body: { ok: false, code: 'INTERNAL_ERROR', message: 'internal_error', correlationId: fallbackCorrelationId },
        headers: responseHeaders
      };
    }
  };
}

type HttpError = Error & { status?: number; statusCode?: number };

export { DEFAULT_DEDUPE_TTL_MS };

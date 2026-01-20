import { createLogger, type Logger } from '@connectors/core-logging';

import { DEFAULT_DEDUPE_TTL_MS } from '../constants.js';
import {
  emitCounter,
  emitHistogram,
  emitSummary,
  computeLatencyMs,
  resolveConnectorForItem,
  COUNTER_METRICS,
  HISTOGRAM_METRICS,
  SUMMARY_METRICS,
  DEFAULT_CAPABILITIES
} from '../observability/utils.js';
import type { OutboundBatchResult, OutboundIntent, OutboundRuntimeOptions, OutboundSendFn } from './types.js';

const OUTBOUND_CAPABILITY_ID = DEFAULT_CAPABILITIES.OUTBOUND_MESSAGES;

function buildLogger(
  baseLogger: Logger | undefined,
  context: Record<string, unknown>,
  defaults: { service: string; connector: string; capabilityId: string }
): Logger {
  const mergedContext = {
    service: defaults.service,
    connector: defaults.connector,
    capabilityId: defaults.capabilityId,
    component: 'outbound',
    ...context
  };

  if (baseLogger) {
    return {
      info: (message, extra) => baseLogger.info(message, { ...mergedContext, ...extra }),
      warn: (message, extra) => baseLogger.warn(message, { ...mergedContext, ...extra }),
      error: (message, extra) => baseLogger.error(message, { ...mergedContext, ...extra })
    };
  }

  return createLogger(mergedContext);
}

function maskPhoneNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length <= 4) {
    return '***';
  }

  const last4 = digits.slice(-4);
  return `***${last4}`;
}

function extractUpstreamStatus(input: unknown): number | undefined {
  if (input && typeof input === 'object' && 'status' in input) {
    const status = (input as { status?: unknown }).status;
    if (typeof status === 'number') {
      return status;
    }
  }
  return undefined;
}

function sanitizeErrorMessage(message?: string): string | undefined {
  if (!message) return undefined;
  const truncated = message.length > 200 ? `${message.slice(0, 200)}...` : message;
  return truncated.replace(/\d{4,}/g, '***');
}

/**
 * Process a batch of outbound message intents with distributed deduplication.
 *
 * - Dedupe happens before any side effect.
 * - On dedupe error:
 *   - failMode 'open' → block send (treated as deduped), log `dedupe_error_blocked`
 *   - failMode 'closed' → allow send, log `dedupe_error_allowed`
 * - Side-effect retries/backoff are the responsibility of the provider client.
 */
export async function processOutboundBatch<TIntent extends OutboundIntent, TProviderResponse = unknown>(
  intents: TIntent[],
  sendMessage: OutboundSendFn<TIntent, TProviderResponse>,
  options: OutboundRuntimeOptions
): Promise<OutboundBatchResult<TProviderResponse>> {
  const {
    dedupeStore,
    dedupeTtlMs = DEFAULT_DEDUPE_TTL_MS,
    logger,
    dedupeFailMode = 'open',
    serviceName,
    connectorId,
    capabilityId
  } = options;
  const service = serviceName ?? 'core-runtime';
  // connectorId from options is used as batch-level fallback only
  const batchConnectorFallback = connectorId;
  const capability = capabilityId ?? OUTBOUND_CAPABILITY_ID;

  const results: OutboundBatchResult<TProviderResponse>['results'] = [];
  const summary = { total: intents.length, sent: 0, deduped: 0, failed: 0 };

  for (const intent of intents) {
    const correlationId = intent.correlationId;
    const startedAt = Date.now();
    
    // Resolve connector PER ITEM from intent.provider (not batch-level)
    const { connector: itemConnector } = resolveConnectorForItem({
      intentProvider: intent.provider,
      manifestId: batchConnectorFallback,
      defaultConnector: 'outbound'
    });
    
    const itemLogger = buildLogger(
      logger,
      {
        correlationId,
        dedupeKey: intent.dedupeKey,
        provider: intent.provider,
        tenantId: intent.tenantId,
        capabilityId: capability,
        connector: itemConnector,
        event: 'outbound_process_item'
      },
      { service, connector: itemConnector, capabilityId: capability }
    );

    let dedupeError: Error | undefined;
    let isDuplicate = false;
    let dedupeErrorCode: 'dedupe_error_blocked' | 'dedupe_error_allowed' | undefined;

    try {
      isDuplicate = await dedupeStore.checkAndMark(intent.dedupeKey, dedupeTtlMs);
    } catch (error) {
      dedupeError = error instanceof Error ? error : new Error(String(error));
      isDuplicate = dedupeFailMode === 'open';
    }

    if (dedupeError) {
      dedupeErrorCode = dedupeFailMode === 'open' ? 'dedupe_error_blocked' : 'dedupe_error_allowed';
      const status = dedupeFailMode === 'open' ? 'deduped' : 'sent';

      const latencyMs = computeLatencyMs(startedAt);
      itemLogger.warn('Dedupe store error', {
        status,
        outcome: status === 'deduped' ? 'deduped' : 'sent',
        errorCode: dedupeErrorCode,
        errorMessage: sanitizeErrorMessage(dedupeError.message),
        latencyMs,
        toMasked: maskPhoneNumber(intent.to)
      });

      if (dedupeFailMode === 'open') {
        summary.deduped += 1;
        // Counter: no latencyMs
        emitCounter(itemLogger, COUNTER_METRICS.EVENT_DEDUPED, 1, {
          connector: itemConnector,
          capabilityId: capability,
          outcome: 'deduped',
          errorCode: dedupeErrorCode
        });
        // Histogram: latencyMs as value
        emitHistogram(itemLogger, HISTOGRAM_METRICS.HANDLER_LATENCY, latencyMs, {
          connector: itemConnector,
          capabilityId: capability,
          outcome: 'deduped'
        });
        results.push({
          intentId: intent.intentId,
          dedupeKey: intent.dedupeKey,
          correlationId,
          provider: intent.provider,
          tenantId: intent.tenantId,
          status: 'deduped',
          errorCode: dedupeErrorCode,
          errorMessage: sanitizeErrorMessage(dedupeError.message),
          latencyMs
        });
        continue;
      }
    }

    if (isDuplicate) {
      const latencyMs = computeLatencyMs(startedAt);
      summary.deduped += 1;
      itemLogger.info('Intent deduped (skipping send)', {
        status: 'deduped',
        outcome: 'deduped',
        latencyMs,
        toMasked: maskPhoneNumber(intent.to)
      });
      // Counter: no latencyMs
      emitCounter(itemLogger, COUNTER_METRICS.EVENT_DEDUPED, 1, {
        connector: itemConnector,
        capabilityId: capability,
        outcome: 'deduped'
      });
      // Histogram: latencyMs as value
      emitHistogram(itemLogger, HISTOGRAM_METRICS.HANDLER_LATENCY, latencyMs, {
        connector: itemConnector,
        capabilityId: capability,
        outcome: 'deduped'
      });
      results.push({
        intentId: intent.intentId,
        dedupeKey: intent.dedupeKey,
        correlationId,
        provider: intent.provider,
        tenantId: intent.tenantId,
        status: 'deduped',
        latencyMs
      });
      continue;
    }

    try {
      const providerResponse = await sendMessage(intent, { logger: itemLogger });
      summary.sent += 1;
      const latencyMs = computeLatencyMs(startedAt);
      const upstreamStatus = extractUpstreamStatus(providerResponse);
      itemLogger.info('Intent sent', {
        status: 'sent',
        outcome: 'sent',
        latencyMs,
        ...(upstreamStatus ? { upstreamStatus } : {}),
        ...(dedupeErrorCode ? { errorCode: dedupeErrorCode } : {}),
        toMasked: maskPhoneNumber(intent.to)
      });
      // Counter: no latencyMs
      emitCounter(itemLogger, COUNTER_METRICS.EVENT_PROCESSED, 1, {
        connector: itemConnector,
        capabilityId: capability,
        outcome: 'sent',
        ...(upstreamStatus ? { upstreamStatus } : {}),
        ...(dedupeErrorCode ? { errorCode: dedupeErrorCode } : {})
      });
      // Histogram: latencyMs as value
      emitHistogram(itemLogger, HISTOGRAM_METRICS.HANDLER_LATENCY, latencyMs, {
        connector: itemConnector,
        capabilityId: capability,
        outcome: 'sent'
      });
      results.push({
        intentId: intent.intentId,
        dedupeKey: intent.dedupeKey,
        correlationId,
        provider: intent.provider,
        tenantId: intent.tenantId,
        status: 'sent',
        latencyMs,
        upstreamStatus,
        ...(dedupeErrorCode ? { errorCode: dedupeErrorCode } : {}),
        providerResponse
      });
    } catch (error) {
      const err = error as Error;
      summary.failed += 1;
      const latencyMs = computeLatencyMs(startedAt);
      const upstreamStatus = extractUpstreamStatus(err);
      itemLogger.error('Intent send failed', {
        status: 'failed',
        outcome: 'failed',
        latencyMs,
        errorCode: dedupeErrorCode ?? 'send_failed',
        ...(upstreamStatus ? { upstreamStatus } : {}),
        errorMessage: sanitizeErrorMessage(err.message),
        toMasked: maskPhoneNumber(intent.to)
      });
      // Counter: no latencyMs
      emitCounter(itemLogger, COUNTER_METRICS.EVENT_FAILED, 1, {
        connector: itemConnector,
        capabilityId: capability,
        outcome: 'failed',
        errorCode: dedupeErrorCode ?? 'send_failed',
        ...(upstreamStatus ? { upstreamStatus } : {})
      });
      // Histogram: latencyMs as value
      emitHistogram(itemLogger, HISTOGRAM_METRICS.HANDLER_LATENCY, latencyMs, {
        connector: itemConnector,
        capabilityId: capability,
        outcome: 'failed'
      });
      results.push({
        intentId: intent.intentId,
        dedupeKey: intent.dedupeKey,
        correlationId,
        provider: intent.provider,
        tenantId: intent.tenantId,
        status: 'failed',
        errorCode: dedupeErrorCode ?? 'send_failed',
        errorMessage: sanitizeErrorMessage(err.message),
        latencyMs,
        ...(upstreamStatus ? { upstreamStatus } : {})
      });
    }
  }

  // For batch summary, use the first intent's provider as connector (since we're summarizing the batch)
  const summaryConnector = batchConnectorFallback ?? intents[0]?.provider ?? 'outbound';
  const summaryLogger = buildLogger(
    logger,
    { correlationId: intents[0]?.correlationId, event: 'outbound_batch_summary' },
    { service, connector: summaryConnector, capabilityId: capability }
  );
  summaryLogger.info('Outbound batch summary', {
    metric: 'event_batch_summary',
    outcome: 'summary',
    total: summary.total,
    sent: summary.sent,
    deduped: summary.deduped,
    failed: summary.failed
  });
  emitSummary(summaryLogger, SUMMARY_METRICS.EVENT_BATCH_SUMMARY, summary.total, {
    connector: summaryConnector,
    capabilityId: capability,
    sent: summary.sent,
    deduped: summary.deduped,
    failed: summary.failed
  });

  return { summary, results };
}

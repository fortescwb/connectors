import { createLogger, type Logger } from '@connectors/core-logging';

import { DEFAULT_DEDUPE_TTL_MS } from '../constants.js';
import { emitMetric, computeLatencyMs, type ObservabilityMetric } from '../observability/utils.js';
import type { OutboundBatchResult, OutboundIntent, OutboundRuntimeOptions, OutboundSendFn } from './types.js';

// OutboundMetric is a subset of ObservabilityMetric (excludes webhook_received_total)
type OutboundMetric = Exclude<ObservabilityMetric, 'webhook_received_total'>;

const OUTBOUND_CAPABILITY_ID = 'outbound_messages';

// emitMetric and computeLatencyMs are now imported from observability/utils.ts

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
  const connector = connectorId ?? intents[0]?.provider ?? 'outbound';
  const capability = capabilityId ?? OUTBOUND_CAPABILITY_ID;

  const results: OutboundBatchResult<TProviderResponse>['results'] = [];
  const summary = { total: intents.length, sent: 0, deduped: 0, failed: 0 };

  for (const intent of intents) {
    const correlationId = intent.correlationId;
    const startedAt = Date.now();
    const itemLogger = buildLogger(
      logger,
      {
        correlationId,
        dedupeKey: intent.dedupeKey,
        provider: intent.provider,
        tenantId: intent.tenantId,
        capabilityId: capability,
        connector,
        event: 'outbound_process_item'
      },
      { service, connector, capabilityId: capability }
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
        errorMessage: dedupeError.message,
        latencyMs,
        toMasked: maskPhoneNumber(intent.to)
      });

      if (dedupeFailMode === 'open') {
        summary.deduped += 1;
        emitMetric(itemLogger, 'event_deduped_total', 1, {
          outcome: 'deduped',
          errorCode: dedupeErrorCode,
          latencyMs
        });
        emitMetric(itemLogger, 'handler_latency_ms', latencyMs, { outcome: 'deduped' });
        results.push({
          intentId: intent.intentId,
          dedupeKey: intent.dedupeKey,
          correlationId,
          provider: intent.provider,
          tenantId: intent.tenantId,
          status: 'deduped',
          errorCode: dedupeErrorCode,
          errorMessage: dedupeError.message,
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
      emitMetric(itemLogger, 'event_deduped_total', 1, { outcome: 'deduped', latencyMs });
      emitMetric(itemLogger, 'handler_latency_ms', latencyMs, { outcome: 'deduped' });
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
      emitMetric(itemLogger, 'event_processed_total', 1, {
        outcome: 'sent',
        latencyMs,
        ...(upstreamStatus ? { upstreamStatus } : {}),
        ...(dedupeErrorCode ? { errorCode: dedupeErrorCode } : {})
      });
      emitMetric(itemLogger, 'handler_latency_ms', latencyMs, { outcome: 'sent' });
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
        errorMessage: err.message,
        toMasked: maskPhoneNumber(intent.to)
      });
      emitMetric(itemLogger, 'event_failed_total', 1, {
        outcome: 'failed',
        errorCode: dedupeErrorCode ?? 'send_failed',
        latencyMs,
        ...(upstreamStatus ? { upstreamStatus } : {})
      });
      emitMetric(itemLogger, 'handler_latency_ms', latencyMs, { outcome: 'failed' });
      results.push({
        intentId: intent.intentId,
        dedupeKey: intent.dedupeKey,
        correlationId,
        provider: intent.provider,
        tenantId: intent.tenantId,
        status: 'failed',
        errorCode: dedupeErrorCode ?? 'send_failed',
        errorMessage: err.message,
        latencyMs,
        ...(upstreamStatus ? { upstreamStatus } : {})
      });
    }
  }

  const summaryLogger = buildLogger(
    logger,
    { correlationId: intents[0]?.correlationId, event: 'outbound_batch_summary' },
    { service, connector, capabilityId: capability }
  );
  summaryLogger.info('Outbound batch summary', {
    metric: 'event_batch_summary',
    outcome: 'summary',
    total: summary.total,
    sent: summary.sent,
    deduped: summary.deduped,
    failed: summary.failed
  });
  emitMetric(summaryLogger, 'event_batch_summary', summary.total, {
    sent: summary.sent,
    deduped: summary.deduped,
    failed: summary.failed
  });

  return { summary, results };
}

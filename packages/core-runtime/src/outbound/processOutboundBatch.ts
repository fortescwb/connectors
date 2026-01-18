import { createLogger, type Logger } from '@connectors/core-logging';

import { DEFAULT_DEDUPE_TTL_MS } from '../constants.js';
import type { OutboundBatchResult, OutboundIntent, OutboundRuntimeOptions, OutboundSendFn } from './types.js';

function buildLogger(baseLogger: Logger | undefined, context: Record<string, unknown>): Logger {
  const mergedContext = { service: 'core-runtime', component: 'outbound', ...context };

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
  const { dedupeStore, dedupeTtlMs = DEFAULT_DEDUPE_TTL_MS, logger, dedupeFailMode = 'open' } = options;

  const results: OutboundBatchResult<TProviderResponse>['results'] = [];
  const summary = { total: intents.length, sent: 0, deduped: 0, failed: 0 };

  for (const intent of intents) {
    const correlationId = intent.correlationId;
    const itemLogger = buildLogger(logger, {
      correlationId,
      dedupeKey: intent.dedupeKey,
      provider: intent.provider,
      tenantId: intent.tenantId,
      event: 'outbound_process_item'
    });

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

      itemLogger.warn('Dedupe store error', {
        status,
        errorCode: dedupeErrorCode,
        errorMessage: dedupeError.message,
        toMasked: maskPhoneNumber(intent.to)
      });

      if (dedupeFailMode === 'open') {
        summary.deduped += 1;
        results.push({
          intentId: intent.intentId,
          dedupeKey: intent.dedupeKey,
          correlationId,
          provider: intent.provider,
          tenantId: intent.tenantId,
          status: 'deduped',
          errorCode: dedupeErrorCode,
          errorMessage: dedupeError.message
        });
        continue;
      }
    }

    if (isDuplicate) {
      summary.deduped += 1;
      itemLogger.info('Intent deduped (skipping send)', {
        status: 'deduped',
        toMasked: maskPhoneNumber(intent.to)
      });
      results.push({
        intentId: intent.intentId,
        dedupeKey: intent.dedupeKey,
        correlationId,
        provider: intent.provider,
        tenantId: intent.tenantId,
        status: 'deduped'
      });
      continue;
    }

    try {
      const providerResponse = await sendMessage(intent, { logger: itemLogger });
      summary.sent += 1;
      itemLogger.info('Intent sent', {
        status: 'sent',
        toMasked: maskPhoneNumber(intent.to)
      });
      results.push({
        intentId: intent.intentId,
        dedupeKey: intent.dedupeKey,
        correlationId,
        provider: intent.provider,
        tenantId: intent.tenantId,
        status: 'sent',
        ...(dedupeErrorCode ? { errorCode: dedupeErrorCode } : {}),
        providerResponse
      });
    } catch (error) {
      const err = error as Error;
      summary.failed += 1;
      itemLogger.error('Intent send failed', {
        status: 'failed',
        errorMessage: err.message,
        toMasked: maskPhoneNumber(intent.to)
      });
      results.push({
        intentId: intent.intentId,
        dedupeKey: intent.dedupeKey,
        correlationId,
        provider: intent.provider,
        tenantId: intent.tenantId,
        status: 'failed',
        errorCode: dedupeErrorCode ?? 'send_failed',
        errorMessage: err.message
      });
    }
  }

  return { summary, results };
}

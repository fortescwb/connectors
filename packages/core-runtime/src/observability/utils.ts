/**
 * @connectors/core-runtime/observability
 *
 * Shared observability utilities for structured logging and metrics.
 * Used by both inbound (index.ts) and outbound (processOutboundBatch.ts) pipelines.
 */

import type { Logger, LoggerContext } from '@connectors/core-logging';

/**
 * Metric names used across the runtime.
 * Combines both inbound and outbound metrics.
 */
export type ObservabilityMetric =
  | 'webhook_received_total'
  | 'event_processed_total'
  | 'event_deduped_total'
  | 'event_failed_total'
  | 'handler_latency_ms'
  | 'event_batch_summary';

/**
 * Emit a structured metric log entry.
 * 
 * @param logger - Logger instance with appropriate context
 * @param metric - Metric name
 * @param value - Metric value (typically a count or duration in ms)
 * @param context - Optional additional context to include in the log
 */
export function emitMetric(
  logger: Logger,
  metric: ObservabilityMetric,
  value: number,
  context?: LoggerContext
): void {
  logger.info('metric', { metric, value, ...context });
}

/**
 * Compute latency in milliseconds given a start timestamp.
 * 
 * @param startedAt - Start time in milliseconds (from Date.now())
 * @returns Elapsed time in milliseconds
 */
export function computeLatencyMs(startedAt: number): number {
  return Date.now() - startedAt;
}

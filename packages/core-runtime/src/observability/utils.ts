/**
 * @connectors/core-runtime/observability
 *
 * Shared observability utilities for structured logging and metrics.
 * Used by both inbound (index.ts) and outbound (processOutboundBatch.ts) pipelines.
 *
 * KEY DESIGN DECISIONS:
 * - Counters NEVER include latencyMs (type-enforced via CounterLabels)
 * - Histograms always include latencyMs as the value (not a label)
 * - Connector is resolved PER ITEM, not at batch level
 */

import type { Logger, LoggerContext } from '@connectors/core-logging';

import type {
  CounterMetricName,
  HistogramMetricName,
  SummaryMetricName,
  CounterLabels,
  HistogramLabels,
  SummaryLabels,
  ObservabilityMetricName
} from './types.js';

// Re-export types for convenience
export type { ObservabilityMetricName as ObservabilityMetric } from './types.js';
export * from './types.js';
export * from './constants.js';

// ─────────────────────────────────────────────────────────────────────────────
// COUNTER EMISSION (NO latencyMs ALLOWED)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Emit a counter metric log entry.
 * 
 * IMPORTANT: CounterLabels type explicitly excludes latencyMs.
 * Counters track occurrences, not durations.
 * 
 * @param logger - Logger instance with appropriate context
 * @param metric - Counter metric name
 * @param value - Count value (typically 1)
 * @param labels - Counter labels (connector, capabilityId, outcome, errorCode, etc.)
 */
export function emitCounter(
  logger: Logger,
  metric: CounterMetricName,
  value: number,
  labels: CounterLabels
): void {
  // Emit structured log with metricType for downstream aggregation
  logger.info('metric', {
    metric,
    metricType: 'counter',
    value,
    ...labels
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// HISTOGRAM EMISSION (latencyMs IS THE VALUE)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Emit a histogram/latency metric log entry.
 * 
 * @param logger - Logger instance with appropriate context
 * @param metric - Histogram metric name
 * @param latencyMs - Latency value in milliseconds (this is the measurement)
 * @param labels - Histogram labels (connector, capabilityId, outcome)
 */
export function emitHistogram(
  logger: Logger,
  metric: HistogramMetricName,
  latencyMs: number,
  labels: HistogramLabels
): void {
  logger.info('metric', {
    metric,
    metricType: 'histogram',
    value: latencyMs,
    ...labels
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY EMISSION (BATCH AGGREGATES)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Emit a summary metric log entry (for batch aggregates).
 * 
 * @param logger - Logger instance with appropriate context
 * @param metric - Summary metric name
 * @param total - Total count in the batch
 * @param labels - Summary labels (connector, capabilityId, processed, deduped, failed)
 */
export function emitSummary(
  logger: Logger,
  metric: SummaryMetricName,
  total: number,
  labels: SummaryLabels
): void {
  logger.info('metric', {
    metric,
    metricType: 'summary',
    value: total,
    ...labels
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY COMPATIBILITY (DEPRECATED - REMOVE IN NEXT MAJOR)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @deprecated Use emitCounter, emitHistogram, or emitSummary instead.
 * This function is kept for backward compatibility only.
 * 
 * Emit a structured metric log entry (legacy).
 * 
 * @param logger - Logger instance with appropriate context
 * @param metric - Metric name
 * @param value - Metric value
 * @param context - Optional additional context
 */
export function emitMetric(
  logger: Logger,
  metric: ObservabilityMetricName,
  value: number,
  context?: LoggerContext
): void {
  // Route to appropriate function based on metric type
  // This legacy function allows any context, but new code should use typed functions
  logger.info('metric', { metric, value, ...context });
}

// ─────────────────────────────────────────────────────────────────────────────
// LATENCY COMPUTATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute latency in milliseconds given a start timestamp.
 * 
 * @param startedAt - Start time in milliseconds (from Date.now())
 * @returns Elapsed time in milliseconds
 */
export function computeLatencyMs(startedAt: number): number {
  return Date.now() - startedAt;
}

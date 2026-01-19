/**
 * @connectors/core-runtime/observability/types
 *
 * Type definitions for observability layer.
 * Separates counter labels from histogram labels to prevent latencyMs leaking into counters.
 */

// ─────────────────────────────────────────────────────────────────────────────
// BRANDED TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Branded ConnectorId type for type-safe connector identification.
 * This represents the connector responsible for processing an event/intent.
 */
export type ConnectorId = string & { readonly __brand: 'ConnectorId' };

/**
 * Create a ConnectorId from a string.
 */
export function asConnectorId(id: string): ConnectorId {
  return id as ConnectorId;
}

// ─────────────────────────────────────────────────────────────────────────────
// METRIC NAMES (UNION TYPES)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Counter metric names (for incrementing counts).
 * These metrics track occurrences and should NEVER include latencyMs.
 */
export type CounterMetricName =
  | 'webhook_received_total'
  | 'event_processed_total'
  | 'event_deduped_total'
  | 'event_failed_total';

/**
 * Histogram/latency metric names (for timing measurements).
 * These metrics track durations and ALWAYS include a numeric value representing latency.
 */
export type HistogramMetricName =
  | 'handler_latency_ms'
  | 'webhook_latency_ms';

/**
 * Summary/gauge metric names (for aggregated counts within a batch).
 */
export type SummaryMetricName = 'event_batch_summary';

/**
 * All observability metric names.
 */
export type ObservabilityMetricName = CounterMetricName | HistogramMetricName | SummaryMetricName;

// ─────────────────────────────────────────────────────────────────────────────
// OUTCOME TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Possible event outcomes for inbound pipeline.
 */
export type InboundOutcome = 'received' | 'processed' | 'deduped' | 'failed';

/**
 * Possible event outcomes for outbound pipeline.
 */
export type OutboundOutcome = 'sent' | 'deduped' | 'failed';

/**
 * Combined outcome type for all pipelines.
 */
export type EventOutcome = InboundOutcome | OutboundOutcome | 'summary';

// ─────────────────────────────────────────────────────────────────────────────
// LABEL TYPES (TYPE-SAFE SEPARATION)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Base labels shared across all metrics.
 * These provide the core dimensions for filtering/grouping.
 */
export interface BaseMetricLabels {
  /** Connector ID resolved per-item (not batch-level) */
  connector: string;
  /** Capability being processed */
  capabilityId?: string;
}

/**
 * Labels allowed on counter metrics.
 * IMPORTANT: latencyMs is explicitly excluded to prevent high-cardinality metrics.
 */
export interface CounterLabels extends BaseMetricLabels {
  /** Event outcome */
  outcome: EventOutcome;
  /** Error code for failure cases */
  errorCode?: string;
  /** Upstream HTTP status (for send operations) */
  upstreamStatus?: number;
}

/**
 * Labels allowed on histogram/latency metrics.
 * These metrics include latencyMs as the value, not as a label.
 */
export interface HistogramLabels extends BaseMetricLabels {
  /** Event outcome */
  outcome: EventOutcome;
}

/**
 * Labels for batch summary metrics.
 */
export interface SummaryLabels extends BaseMetricLabels {
  /** Number of events processed successfully */
  processed?: number;
  /** Number of events sent (outbound) */
  sent?: number;
  /** Number of events deduplicated */
  deduped?: number;
  /** Number of events failed */
  failed?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPE GUARDS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a metric name is a counter metric.
 */
export function isCounterMetric(name: ObservabilityMetricName): name is CounterMetricName {
  return (
    name === 'webhook_received_total' ||
    name === 'event_processed_total' ||
    name === 'event_deduped_total' ||
    name === 'event_failed_total'
  );
}

/**
 * Check if a metric name is a histogram metric.
 */
export function isHistogramMetric(name: ObservabilityMetricName): name is HistogramMetricName {
  return name === 'handler_latency_ms' || name === 'webhook_latency_ms';
}

/**
 * Check if a metric name is a summary metric.
 */
export function isSummaryMetric(name: ObservabilityMetricName): name is SummaryMetricName {
  return name === 'event_batch_summary';
}

// ─────────────────────────────────────────────────────────────────────────────
// CONNECTOR RESOLUTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of connector resolution for an item.
 */
export interface ConnectorResolution {
  /** Resolved connector ID */
  connector: string;
  /** Resolution source for debugging */
  source: 'item' | 'intent' | 'manifest' | 'fallback';
}

/**
 * Options for resolving connector from an item.
 */
export interface ConnectorResolutionOptions {
  /** Explicit connector from the item/event */
  itemConnector?: string;
  /** Provider from intent (outbound) */
  intentProvider?: string;
  /** Manifest ID as fallback */
  manifestId?: string;
  /** Default fallback value */
  defaultConnector?: string;
}

/**
 * Resolve connector ID for an item deterministically.
 *
 * Priority:
 * 1. itemConnector (from ParsedEvent.connector)
 * 2. intentProvider (from OutboundIntent.provider)
 * 3. manifestId (from ConnectorManifest.id)
 * 4. defaultConnector (final fallback)
 *
 * @param options Resolution options with potential connector sources
 * @returns Resolved connector with source indication
 */
export function resolveConnectorForItem(options: ConnectorResolutionOptions): ConnectorResolution {
  const { itemConnector, intentProvider, manifestId, defaultConnector = 'unknown' } = options;

  if (itemConnector) {
    return { connector: itemConnector, source: 'item' };
  }

  if (intentProvider) {
    return { connector: intentProvider, source: 'intent' };
  }

  if (manifestId) {
    return { connector: manifestId, source: 'manifest' };
  }

  return { connector: defaultConnector, source: 'fallback' };
}

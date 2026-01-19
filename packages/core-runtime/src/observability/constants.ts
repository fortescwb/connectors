/**
 * @connectors/core-runtime/observability/constants
 *
 * Centralized metric names and label contracts.
 * All metric names should be referenced from here to ensure consistency.
 */

import type {
  CounterMetricName,
  HistogramMetricName,
  SummaryMetricName
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// COUNTER METRIC NAMES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Counter metric names object for easy reference.
 */
export const COUNTER_METRICS = {
  /** Total webhooks received */
  WEBHOOK_RECEIVED: 'webhook_received_total' as CounterMetricName,
  /** Total events processed successfully */
  EVENT_PROCESSED: 'event_processed_total' as CounterMetricName,
  /** Total events deduplicated */
  EVENT_DEDUPED: 'event_deduped_total' as CounterMetricName,
  /** Total events failed */
  EVENT_FAILED: 'event_failed_total' as CounterMetricName
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// HISTOGRAM METRIC NAMES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Histogram/latency metric names object for easy reference.
 */
export const HISTOGRAM_METRICS = {
  /** Handler execution latency */
  HANDLER_LATENCY: 'handler_latency_ms' as HistogramMetricName,
  /** Webhook request-to-response latency */
  WEBHOOK_LATENCY: 'webhook_latency_ms' as HistogramMetricName
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY METRIC NAMES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Summary metric names object for easy reference.
 */
export const SUMMARY_METRICS = {
  /** Batch processing summary */
  EVENT_BATCH_SUMMARY: 'event_batch_summary' as SummaryMetricName
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// LABEL KEYS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Standard label keys used across metrics.
 */
export const METRIC_LABELS = {
  /** Connector identifier */
  CONNECTOR: 'connector',
  /** Capability identifier */
  CAPABILITY_ID: 'capabilityId',
  /** Event outcome */
  OUTCOME: 'outcome',
  /** Error code */
  ERROR_CODE: 'errorCode',
  /** Upstream HTTP status */
  UPSTREAM_STATUS: 'upstreamStatus'
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// ERROR CODES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Standard error codes used in metrics and logs.
 */
export const ERROR_CODES = {
  /** No handler registered for capability */
  NO_HANDLER: 'NO_HANDLER',
  /** Handler execution failed */
  HANDLER_FAILED: 'HANDLER_FAILED',
  /** Send operation failed */
  SEND_FAILED: 'send_failed',
  /** Dedupe store error - blocked send (fail-open) */
  DEDUPE_ERROR_BLOCKED: 'dedupe_error_blocked',
  /** Dedupe store error - allowed send (fail-closed) */
  DEDUPE_ERROR_ALLOWED: 'dedupe_error_allowed',
  /** Connector resolution failed */
  CONNECTOR_RESOLUTION_FAILED: 'connector_resolution_failed'
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

// ─────────────────────────────────────────────────────────────────────────────
// CAPABILITY DEFAULTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default capability IDs.
 */
export const DEFAULT_CAPABILITIES = {
  /** Outbound messaging capability */
  OUTBOUND_MESSAGES: 'outbound_messages',
  /** Mixed capabilities (for heterogeneous batches) */
  MIXED: 'mixed'
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// CONNECTOR DEFAULTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default connector IDs for fallback scenarios.
 */
export const DEFAULT_CONNECTORS = {
  /** Outbound pipeline default */
  OUTBOUND: 'outbound',
  /** Unknown connector (fallback) */
  UNKNOWN: 'unknown'
} as const;

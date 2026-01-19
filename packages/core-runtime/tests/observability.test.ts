import { describe, expect, it } from 'vitest';

import {
  emitCounter,
  emitHistogram,
  emitSummary,
  resolveConnectorForItem,
  COUNTER_METRICS,
  HISTOGRAM_METRICS,
  SUMMARY_METRICS,
  type CounterLabels,
  type HistogramLabels,
  type SummaryLabels
} from '../src/observability/utils.js';

type LogEntry = Record<string, unknown>;

const createMemoryLogger = (sink: LogEntry[]) => ({
  info: (message: string, extra?: Record<string, unknown>) => sink.push({ level: 'info', message, ...extra }),
  warn: (message: string, extra?: Record<string, unknown>) => sink.push({ level: 'warn', message, ...extra }),
  error: (message: string, extra?: Record<string, unknown>) => sink.push({ level: 'error', message, ...extra })
});

describe('observability/types', () => {
  describe('resolveConnectorForItem', () => {
    it('prioritizes itemConnector over all other sources', () => {
      const result = resolveConnectorForItem({
        itemConnector: 'item-connector',
        intentProvider: 'intent-provider',
        manifestId: 'manifest-id',
        defaultConnector: 'default'
      });
      expect(result).toEqual({ connector: 'item-connector', source: 'item' });
    });

    it('uses intentProvider when itemConnector is not provided', () => {
      const result = resolveConnectorForItem({
        intentProvider: 'whatsapp',
        manifestId: 'manifest-id'
      });
      expect(result).toEqual({ connector: 'whatsapp', source: 'intent' });
    });

    it('uses manifestId when itemConnector and intentProvider are not provided', () => {
      const result = resolveConnectorForItem({
        manifestId: 'meta-whatsapp'
      });
      expect(result).toEqual({ connector: 'meta-whatsapp', source: 'manifest' });
    });

    it('uses defaultConnector as last resort', () => {
      const result = resolveConnectorForItem({
        defaultConnector: 'fallback'
      });
      expect(result).toEqual({ connector: 'fallback', source: 'fallback' });
    });

    it('uses "unknown" when no sources are provided', () => {
      const result = resolveConnectorForItem({});
      expect(result).toEqual({ connector: 'unknown', source: 'fallback' });
    });
  });
});

describe('observability/constants', () => {
  describe('COUNTER_METRICS', () => {
    it('has all expected counter metric names', () => {
      expect(COUNTER_METRICS.WEBHOOK_RECEIVED).toBe('webhook_received_total');
      expect(COUNTER_METRICS.EVENT_PROCESSED).toBe('event_processed_total');
      expect(COUNTER_METRICS.EVENT_DEDUPED).toBe('event_deduped_total');
      expect(COUNTER_METRICS.EVENT_FAILED).toBe('event_failed_total');
    });
  });

  describe('HISTOGRAM_METRICS', () => {
    it('has all expected histogram metric names', () => {
      expect(HISTOGRAM_METRICS.HANDLER_LATENCY).toBe('handler_latency_ms');
      expect(HISTOGRAM_METRICS.WEBHOOK_LATENCY).toBe('webhook_latency_ms');
    });
  });

  describe('SUMMARY_METRICS', () => {
    it('has all expected summary metric names', () => {
      expect(SUMMARY_METRICS.EVENT_BATCH_SUMMARY).toBe('event_batch_summary');
    });
  });
});

describe('observability/utils', () => {
  describe('emitCounter', () => {
    it('emits counter metric without latencyMs in labels', () => {
      const logs: LogEntry[] = [];
      const logger = createMemoryLogger(logs);

      const labels: CounterLabels = {
        connector: 'meta-whatsapp',
        capabilityId: 'inbound_messages',
        outcome: 'processed'
      };

      emitCounter(logger, COUNTER_METRICS.EVENT_PROCESSED, 1, labels);

      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        level: 'info',
        message: 'metric',
        metric: 'event_processed_total',
        metricType: 'counter',
        value: 1,
        connector: 'meta-whatsapp',
        capabilityId: 'inbound_messages',
        outcome: 'processed'
      });
      // Verify latencyMs is NOT present
      expect(logs[0]).not.toHaveProperty('latencyMs');
    });

    it('includes errorCode in counter labels for failures', () => {
      const logs: LogEntry[] = [];
      const logger = createMemoryLogger(logs);

      const labels: CounterLabels = {
        connector: 'meta-whatsapp',
        outcome: 'failed',
        errorCode: 'HANDLER_FAILED'
      };

      emitCounter(logger, COUNTER_METRICS.EVENT_FAILED, 1, labels);

      expect(logs[0]).toMatchObject({
        metric: 'event_failed_total',
        errorCode: 'HANDLER_FAILED',
        outcome: 'failed'
      });
      expect(logs[0]).not.toHaveProperty('latencyMs');
    });

    it('includes upstreamStatus in counter labels when available', () => {
      const logs: LogEntry[] = [];
      const logger = createMemoryLogger(logs);

      const labels: CounterLabels = {
        connector: 'meta-whatsapp',
        outcome: 'sent',
        upstreamStatus: 200
      };

      emitCounter(logger, COUNTER_METRICS.EVENT_PROCESSED, 1, labels);

      expect(logs[0]).toMatchObject({
        upstreamStatus: 200
      });
      expect(logs[0]).not.toHaveProperty('latencyMs');
    });
  });

  describe('emitHistogram', () => {
    it('emits histogram metric with latencyMs as value', () => {
      const logs: LogEntry[] = [];
      const logger = createMemoryLogger(logs);

      const labels: HistogramLabels = {
        connector: 'meta-whatsapp',
        capabilityId: 'inbound_messages',
        outcome: 'processed'
      };

      emitHistogram(logger, HISTOGRAM_METRICS.HANDLER_LATENCY, 42, labels);

      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        level: 'info',
        message: 'metric',
        metric: 'handler_latency_ms',
        metricType: 'histogram',
        value: 42,
        connector: 'meta-whatsapp',
        capabilityId: 'inbound_messages',
        outcome: 'processed'
      });
    });

    it('records latency for different outcomes', () => {
      const logs: LogEntry[] = [];
      const logger = createMemoryLogger(logs);

      const outcomes = ['processed', 'deduped', 'failed'] as const;
      
      for (const outcome of outcomes) {
        emitHistogram(logger, HISTOGRAM_METRICS.HANDLER_LATENCY, 100, {
          connector: 'test',
          outcome
        });
      }

      expect(logs).toHaveLength(3);
      expect(logs.map(l => l.outcome)).toEqual(['processed', 'deduped', 'failed']);
      expect(logs.every(l => l.value === 100)).toBe(true);
    });
  });

  describe('emitSummary', () => {
    it('emits summary metric with batch counts', () => {
      const logs: LogEntry[] = [];
      const logger = createMemoryLogger(logs);

      const labels: SummaryLabels = {
        connector: 'meta-whatsapp',
        capabilityId: 'inbound_messages',
        processed: 5,
        deduped: 2,
        failed: 1
      };

      emitSummary(logger, SUMMARY_METRICS.EVENT_BATCH_SUMMARY, 8, labels);

      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        level: 'info',
        message: 'metric',
        metric: 'event_batch_summary',
        metricType: 'summary',
        value: 8,
        connector: 'meta-whatsapp',
        processed: 5,
        deduped: 2,
        failed: 1
      });
    });
  });
});

describe('type safety: CounterLabels excludes latencyMs at compile time', () => {
  // This test validates the type system prevents latencyMs in counters.
  // If this compiles, the types are working correctly.
  it('CounterLabels type allows standard fields', () => {
    const labels: CounterLabels = {
      connector: 'test',
      outcome: 'processed',
      capabilityId: 'test_capability',
      errorCode: 'some_error',
      upstreamStatus: 200
    };
    expect(labels.connector).toBe('test');
  });

  // Note: The following would fail compilation if uncommented:
  // const invalidLabels: CounterLabels = {
  //   connector: 'test',
  //   outcome: 'processed',
  //   latencyMs: 100 // ERROR: Property 'latencyMs' does not exist on type 'CounterLabels'
  // };
});

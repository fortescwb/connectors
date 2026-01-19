import { describe, expect, it, vi } from 'vitest';

import type { ConnectorManifest } from '@connectors/core-connectors';

import {
  buildWebhookHandlers,
  type CapabilityRegistry,
  type ParsedEvent,
  type RuntimeRequest
} from '../src/index.js';

type LogEntry = Record<string, unknown>;

const testManifest: ConnectorManifest = {
  id: 'test-connector',
  name: 'Test Connector',
  version: '0.1.0',
  platform: 'test',
  capabilities: [{ id: 'inbound_messages', status: 'active' }],
  webhookPath: '/webhook',
  healthPath: '/health',
  requiredEnvVars: [],
  optionalEnvVars: []
};

function makeRequest(overrides: Partial<RuntimeRequest> = {}): RuntimeRequest {
  return {
    headers: {},
    query: {},
    body: {},
    ...overrides
  };
}

function makeEvent(id: string, overrides: Partial<ParsedEvent> = {}): ParsedEvent {
  return {
    capabilityId: 'inbound_messages',
    dedupeKey: `dedupe:${id}`,
    payload: { id },
    ...overrides
  };
}

const createMemoryLogger = (sink: LogEntry[]) => ({
  info: (message: string, extra?: Record<string, unknown>) => sink.push({ level: 'info', message, ...extra }),
  warn: (message: string, extra?: Record<string, unknown>) => sink.push({ level: 'warn', message, ...extra }),
  error: (message: string, extra?: Record<string, unknown>) => sink.push({ level: 'error', message, ...extra })
});

describe('inbound pipeline observability', () => {
  describe('connector per-item resolution', () => {
    it('uses event.connector when provided (per-item)', async () => {
      const logs: LogEntry[] = [];
      const logger = createMemoryLogger(logs);
      const handler = vi.fn().mockResolvedValue(undefined);
      const registry: CapabilityRegistry = { inbound_messages: handler };

      const { handlePost } = buildWebhookHandlers({
        manifest: testManifest,
        registry,
        logger,
        parseEvents: async () => [
          makeEvent('1', { connector: 'whatsapp' }),
          makeEvent('2', { connector: 'instagram' }),
          makeEvent('3', { connector: 'facebook' })
        ]
      });

      await handlePost(makeRequest());

      // Verify each event's structured log has its own connector
      const processedLogs = logs.filter((log) => log['message'] === 'Event processed successfully');
      expect(processedLogs).toHaveLength(3);
      
      const connectors = processedLogs.map((log) => log['connector']);
      expect(connectors).toContain('whatsapp');
      expect(connectors).toContain('instagram');
      expect(connectors).toContain('facebook');
    });

    it('falls back to manifest.id when event.connector is not provided', async () => {
      const logs: LogEntry[] = [];
      const logger = createMemoryLogger(logs);
      const handler = vi.fn().mockResolvedValue(undefined);
      const registry: CapabilityRegistry = { inbound_messages: handler };

      const { handlePost } = buildWebhookHandlers({
        manifest: testManifest,
        registry,
        logger,
        parseEvents: async () => [
          makeEvent('1'), // No connector specified
          makeEvent('2')
        ]
      });

      await handlePost(makeRequest());

      const processedLogs = logs.filter((log) => log['message'] === 'Event processed successfully');
      expect(processedLogs).toHaveLength(2);
      expect(processedLogs.every((log) => log['connector'] === 'test-connector')).toBe(true);
    });

    it('handles mixed batch with some events having connector and some without', async () => {
      const logs: LogEntry[] = [];
      const logger = createMemoryLogger(logs);
      const handler = vi.fn().mockResolvedValue(undefined);
      const registry: CapabilityRegistry = { inbound_messages: handler };

      const { handlePost } = buildWebhookHandlers({
        manifest: testManifest,
        registry,
        logger,
        parseEvents: async () => [
          makeEvent('1', { connector: 'whatsapp' }),
          makeEvent('2'), // Falls back to manifest.id
          makeEvent('3', { connector: 'telegram' })
        ]
      });

      await handlePost(makeRequest());

      const processedLogs = logs.filter((log) => log['message'] === 'Event processed successfully');
      expect(processedLogs).toHaveLength(3);
      
      const connectors = processedLogs.map((log) => log['connector']);
      expect(connectors).toEqual(['whatsapp', 'test-connector', 'telegram']);
    });
  });

  describe('counters exclude latencyMs', () => {
    it('counter metrics do not include latencyMs', async () => {
      const logs: LogEntry[] = [];
      const logger = createMemoryLogger(logs);
      const handler = vi.fn().mockResolvedValue(undefined);
      const registry: CapabilityRegistry = { inbound_messages: handler };

      const { handlePost } = buildWebhookHandlers({
        manifest: testManifest,
        registry,
        logger,
        parseEvents: async () => [makeEvent('1')]
      });

      await handlePost(makeRequest());

      // Find counter metrics
      const counterMetrics = logs.filter(
        (log) => log['metricType'] === 'counter'
      );
      
      expect(counterMetrics.length).toBeGreaterThan(0);
      for (const metric of counterMetrics) {
        expect(metric).not.toHaveProperty('latencyMs');
      }
    });

    it('histogram metrics include latencyMs as value', async () => {
      const logs: LogEntry[] = [];
      const logger = createMemoryLogger(logs);
      const handler = vi.fn().mockResolvedValue(undefined);
      const registry: CapabilityRegistry = { inbound_messages: handler };

      const { handlePost } = buildWebhookHandlers({
        manifest: testManifest,
        registry,
        logger,
        parseEvents: async () => [makeEvent('1')]
      });

      await handlePost(makeRequest());

      // Find histogram metrics
      const histogramMetrics = logs.filter(
        (log) => log['metricType'] === 'histogram'
      );
      
      expect(histogramMetrics.length).toBeGreaterThan(0);
      for (const metric of histogramMetrics) {
        expect(typeof metric['value']).toBe('number');
        expect(metric['metric']).toBe('handler_latency_ms');
      }
    });

    it('structured logs still include latencyMs for debugging', async () => {
      const logs: LogEntry[] = [];
      const logger = createMemoryLogger(logs);
      const handler = vi.fn().mockResolvedValue(undefined);
      const registry: CapabilityRegistry = { inbound_messages: handler };

      const { handlePost } = buildWebhookHandlers({
        manifest: testManifest,
        registry,
        logger,
        parseEvents: async () => [makeEvent('1')]
      });

      await handlePost(makeRequest());

      // Structured logs (not metrics) should still have latencyMs
      const processedLog = logs.find((log) => log['message'] === 'Event processed successfully');
      expect(processedLog).toBeDefined();
      expect(typeof processedLog?.latencyMs).toBe('number');
    });
  });

  describe('counter metrics include connector per-item', () => {
    it('event_processed_total counter includes per-item connector', async () => {
      const logs: LogEntry[] = [];
      const logger = createMemoryLogger(logs);
      const handler = vi.fn().mockResolvedValue(undefined);
      const registry: CapabilityRegistry = { inbound_messages: handler };

      const { handlePost } = buildWebhookHandlers({
        manifest: testManifest,
        registry,
        logger,
        parseEvents: async () => [
          makeEvent('1', { connector: 'custom-connector' })
        ]
      });

      await handlePost(makeRequest());

      const processedCounter = logs.find(
        (log) => log['metric'] === 'event_processed_total' && log['metricType'] === 'counter'
      );
      
      expect(processedCounter).toBeDefined();
      expect(processedCounter?.connector).toBe('custom-connector');
      expect(processedCounter).not.toHaveProperty('latencyMs');
    });

    it('event_deduped_total counter includes per-item connector', async () => {
      const logs: LogEntry[] = [];
      const logger = createMemoryLogger(logs);
      const handler = vi.fn().mockResolvedValue(undefined);
      const registry: CapabilityRegistry = { inbound_messages: handler };
      const dedupeStore = {
        checkAndMark: vi.fn<[string, number], Promise<boolean>>()
          .mockResolvedValueOnce(false)
          .mockResolvedValueOnce(true) // Second event is duplicate
      };

      const { handlePost } = buildWebhookHandlers({
        manifest: testManifest,
        registry,
        logger,
        dedupeStore,
        parseEvents: async () => [
          makeEvent('dup', { connector: 'connector-a' }),
          makeEvent('dup', { connector: 'connector-b' })
        ]
      });

      await handlePost(makeRequest());

      const dedupedCounter = logs.find(
        (log) => log['metric'] === 'event_deduped_total' && log['metricType'] === 'counter'
      );
      
      expect(dedupedCounter).toBeDefined();
      expect(dedupedCounter?.connector).toBe('connector-b');
      expect(dedupedCounter).not.toHaveProperty('latencyMs');
    });

    it('event_failed_total counter includes per-item connector', async () => {
      const logs: LogEntry[] = [];
      const logger = createMemoryLogger(logs);
      const handler = vi.fn().mockRejectedValue(new Error('handler error'));
      const registry: CapabilityRegistry = { inbound_messages: handler };

      const { handlePost } = buildWebhookHandlers({
        manifest: testManifest,
        registry,
        logger,
        parseEvents: async () => [
          makeEvent('1', { connector: 'failing-connector' })
        ]
      });

      await handlePost(makeRequest());

      const failedCounter = logs.find(
        (log) => log['metric'] === 'event_failed_total' && log['metricType'] === 'counter'
      );
      
      expect(failedCounter).toBeDefined();
      expect(failedCounter?.connector).toBe('failing-connector');
      expect(failedCounter?.errorCode).toBe('HANDLER_FAILED');
      expect(failedCounter).not.toHaveProperty('latencyMs');
    });
  });
});

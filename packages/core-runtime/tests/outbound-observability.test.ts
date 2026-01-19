import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { OutboundMessageIntent } from '@connectors/core-messaging';

import { processOutboundBatch } from '../src/outbound/processOutboundBatch.js';

type LogEntry = Record<string, unknown>;

const makeIntent = (overrides: Partial<OutboundMessageIntent> = {}): OutboundMessageIntent => ({
  intentId: randomUUID(),
  tenantId: 'tenant-outbound',
  provider: 'whatsapp',
  to: '+15551234567',
  payload: { type: 'text', text: 'hello' },
  dedupeKey: overrides.dedupeKey ?? randomUUID(),
  correlationId: overrides.correlationId ?? randomUUID(),
  createdAt: new Date().toISOString(),
  ...overrides
});

const createMemoryLogger = (sink: LogEntry[]) => ({
  info: (message: string, extra?: Record<string, unknown>) => sink.push({ level: 'info', message, ...extra }),
  warn: (message: string, extra?: Record<string, unknown>) => sink.push({ level: 'warn', message, ...extra }),
  error: (message: string, extra?: Record<string, unknown>) => sink.push({ level: 'error', message, ...extra })
});

describe('processOutboundBatch observability', () => {
  it('emits required fields and metrics for outbound intents', async () => {
    const logs: LogEntry[] = [];
    const logger = createMemoryLogger(logs);
    const dedupeStore = {
      checkAndMark: vi
        .fn<[string, number], Promise<boolean>>()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
    };

    const intents = [
      makeIntent({ dedupeKey: 'out-1', correlationId: 'corr-out-1' }),
      makeIntent({ dedupeKey: 'out-2', correlationId: 'corr-out-2' }),
      makeIntent({ dedupeKey: 'out-3', correlationId: 'corr-out-3' })
    ];

    const result = await processOutboundBatch(
      intents,
      async (intent) => {
        if (intent.dedupeKey === 'out-3') {
          throw new Error('send failed');
        }
        return { status: 200 };
      },
      { dedupeStore, logger, connectorId: 'meta-whatsapp', serviceName: 'connectors-runtime' }
    );

    expect(result.summary).toMatchObject({ sent: 1, deduped: 1, failed: 1 });

    const sentLog = logs.find((log) => log['message'] === 'Intent sent');
    expect(sentLog).toMatchObject({
      service: 'connectors-runtime',
      connector: 'whatsapp', // Now resolved PER ITEM from intent.provider
      capabilityId: 'outbound_messages',
      outcome: 'sent',
      dedupeKey: 'out-1',
      tenantId: 'tenant-outbound'
    });
    expect(typeof sentLog?.latencyMs).toBe('number');

    const dedupeLog = logs.find((log) => log['message'] === 'Intent deduped (skipping send)');
    expect(dedupeLog).toMatchObject({
      connector: 'whatsapp', // Resolved from intent.provider
      capabilityId: 'outbound_messages',
      outcome: 'deduped',
      dedupeKey: 'out-2'
    });
    expect(typeof dedupeLog?.latencyMs).toBe('number');

    const failedLog = logs.find((log) => log['message'] === 'Intent send failed');
    expect(failedLog).toMatchObject({
      connector: 'whatsapp', // Resolved from intent.provider
      capabilityId: 'outbound_messages',
      outcome: 'failed',
      errorCode: 'send_failed'
    });
    expect(typeof failedLog?.latencyMs).toBe('number');

    // Verify counter metrics do NOT include latencyMs
    const processedMetric = logs.find((log) => log['metric'] === 'event_processed_total' && log['dedupeKey'] === 'out-1');
    expect(processedMetric).toMatchObject({ 
      connector: 'whatsapp', // Per-item connector
      outcome: 'sent',
      metricType: 'counter'
    });
    expect(processedMetric).not.toHaveProperty('latencyMs');

    const dedupedMetric = logs.find((log) => log['metric'] === 'event_deduped_total' && log['dedupeKey'] === 'out-2');
    expect(dedupedMetric).toMatchObject({ 
      outcome: 'deduped',
      metricType: 'counter'
    });
    expect(dedupedMetric).not.toHaveProperty('latencyMs');

    const failedMetric = logs.find((log) => log['metric'] === 'event_failed_total' && log['dedupeKey'] === 'out-3');
    expect(failedMetric).toMatchObject({ 
      outcome: 'failed', 
      errorCode: 'send_failed',
      metricType: 'counter'
    });
    expect(failedMetric).not.toHaveProperty('latencyMs');

    // Verify histogram metrics include latencyMs as value
    const latencyMetrics = logs.filter((log) => log['metric'] === 'handler_latency_ms');
    expect(latencyMetrics).toHaveLength(3);
    expect(latencyMetrics.every((log) => typeof log['value'] === 'number')).toBe(true);
    expect(latencyMetrics.every((log) => log['metricType'] === 'histogram')).toBe(true);
  });

  it('resolves connector per-item from intent.provider, not batch-level', async () => {
    const logs: LogEntry[] = [];
    const logger = createMemoryLogger(logs);
    const dedupeStore = {
      checkAndMark: vi.fn<[string, number], Promise<boolean>>().mockResolvedValue(false)
    };

    // Create intents with different providers
    const intents = [
      makeIntent({ dedupeKey: 'wa-1', provider: 'whatsapp', correlationId: 'corr-1' }),
      makeIntent({ dedupeKey: 'ig-1', provider: 'instagram', correlationId: 'corr-2' }),
      makeIntent({ dedupeKey: 'fb-1', provider: 'facebook', correlationId: 'corr-3' })
    ];

    await processOutboundBatch(
      intents,
      async () => ({ status: 200 }),
      { dedupeStore, logger, serviceName: 'test-service' }
    );

    // Verify each item has its own connector from intent.provider
    const sentLogs = logs.filter((log) => log['message'] === 'Intent sent');
    expect(sentLogs).toHaveLength(3);
    
    const connectors = sentLogs.map((log) => log['connector']);
    expect(connectors).toContain('whatsapp');
    expect(connectors).toContain('instagram');
    expect(connectors).toContain('facebook');

    // Verify counters also have per-item connectors
    const counterMetrics = logs.filter((log) => log['metric'] === 'event_processed_total');
    expect(counterMetrics).toHaveLength(3);
    
    const counterConnectors = counterMetrics.map((log) => log['connector']);
    expect(counterConnectors).toContain('whatsapp');
    expect(counterConnectors).toContain('instagram');
    expect(counterConnectors).toContain('facebook');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ConnectorManifest } from '@connectors/core-connectors';

import {
  buildWebhookHandlers,
  type CapabilityRegistry,
  type ParsedEvent,
  type DedupeStore,
  type RuntimeRequest,
  type SignatureVerifier,
  type SuccessResponseBody
} from '../src/index.js';

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

describe('batch processing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('processes all events in a batch', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const registry: CapabilityRegistry = { inbound_messages: handler };

    const { handlePost } = buildWebhookHandlers({
      manifest: testManifest,
      registry,
      parseEvents: async () => [makeEvent('1'), makeEvent('2'), makeEvent('3')]
    });

    const response = await handlePost(makeRequest());

    expect(response.status).toBe(200);
    const body = response.body as SuccessResponseBody;
    expect(body.summary).toEqual({ total: 3, processed: 3, deduped: 0, failed: 0 });
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('dedupes duplicate items within the batch', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const registry: CapabilityRegistry = { inbound_messages: handler };

    const { handlePost } = buildWebhookHandlers({
      manifest: testManifest,
      registry,
      parseEvents: async () => [makeEvent('dup'), makeEvent('dup', { correlationId: 'batch-corr' })]
    });

    const response = await handlePost(makeRequest());

    expect(response.status).toBe(200);
    const body = response.body as SuccessResponseBody;
    expect(body.summary.total).toBe(2);
    expect(body.summary.deduped).toBe(1);
    expect(body.summary.processed).toBe(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('continues processing when one item fails', async () => {
    const handler = vi.fn(async (payload: { id: string }) => {
      if (payload.id === 'fail') {
        throw new Error('handler failed');
      }
    });
    const registry: CapabilityRegistry = { inbound_messages: handler };

    const { handlePost } = buildWebhookHandlers({
      manifest: testManifest,
      registry,
      parseEvents: async () => [makeEvent('ok-1'), makeEvent('fail'), makeEvent('ok-2')]
    });

    const response = await handlePost(makeRequest());

    expect(response.status).toBe(200);
    const body = response.body as SuccessResponseBody;
    expect(body.summary.failed).toBe(1);
    expect(body.summary.processed).toBe(2);
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('returns 200 with all failed when every item fails', async () => {
    const handler = vi.fn(async () => {
      throw new Error('always fails');
    });
    const registry: CapabilityRegistry = { inbound_messages: handler };

    const { handlePost } = buildWebhookHandlers({
      manifest: testManifest,
      registry,
      parseEvents: async () => [makeEvent('f1'), makeEvent('f2'), makeEvent('f3')]
    });

    const response = await handlePost(makeRequest());

    expect(response.status).toBe(200);
    const body = response.body as SuccessResponseBody;
    expect(body.summary).toEqual({ total: 3, processed: 0, deduped: 0, failed: 3 });
    expect(body.fullyDeduped).toBe(false);
    expect(body.results).toHaveLength(3);
    expect(body.results?.every((r) => r.ok === false && r.errorCode === 'HANDLER_FAILED')).toBe(true);
  });

  it('returns 200 with all failed when no handlers registered', async () => {
    const { handlePost } = buildWebhookHandlers({
      manifest: testManifest,
      registry: {},
      parseEvents: async () => [makeEvent('a'), makeEvent('b')]
    });

    const response = await handlePost(makeRequest());

    expect(response.status).toBe(200);
    const body = response.body as SuccessResponseBody;
    expect(body.summary).toEqual({ total: 2, processed: 0, deduped: 0, failed: 2 });
    expect(body.fullyDeduped).toBe(false);
    expect(body.results?.every((r) => r.errorCode === 'NO_HANDLER')).toBe(true);
  });

  it('verifies signature only once per batch', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const registry: CapabilityRegistry = { inbound_messages: handler };
    const verifySpy = vi.fn().mockResolvedValue({ valid: true });
    const verifier: SignatureVerifier = {
      enabled: true,
      verify: verifySpy
    };

    const { handlePost } = buildWebhookHandlers({
      manifest: testManifest,
      registry,
      parseEvents: async () => [makeEvent('a'), makeEvent('b')],
      signatureVerifier: verifier
    });

    const response = await handlePost(
      makeRequest({
        rawBody: Buffer.from('{}')
      })
    );

    expect(response.status).toBe(200);
    expect(verifySpy).toHaveBeenCalledTimes(1);
  });

  it('logs per item with correlationId and dedupeKey', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const handler = vi.fn().mockResolvedValue(undefined);
    const registry: CapabilityRegistry = { inbound_messages: handler };

    const correlationId = 'corr-batch-1';
    const { handlePost } = buildWebhookHandlers({
      manifest: testManifest,
      registry,
      parseEvents: async () => [
        makeEvent('log-1', { correlationId, tenant: 'tenant-log' }),
        makeEvent('log-2', { tenant: 'tenant-log' }) // will be deduped
      ]
    });

    // First request establishes dedupe entry for the second item
    await handlePost(makeRequest());
    const response = await handlePost(makeRequest());

    expect(response.status).toBe(200);

    const logs = logSpy.mock.calls
      .map(([entry]) => {
        try {
          return JSON.parse(entry as string);
        } catch {
          return null;
        }
      })
      .filter(Boolean) as Record<string, unknown>[];

    const processedLog = logs.find(
      (log) => log['message'] === 'Event processed successfully' && log['dedupeKey'] === 'dedupe:log-1'
    );
    const dedupeLog = logs.find(
      (log) => log['message'] === 'Duplicate event skipped' && log['dedupeKey'] === 'dedupe:log-2'
    );

    expect(processedLog?.correlationId).toBe(correlationId);
    expect(processedLog?.dedupeKey).toBe('dedupe:log-1');
    expect(processedLog?.capabilityId).toBe('inbound_messages');
    expect(processedLog?.service).toBe('test-connector');
    expect(processedLog?.connector).toBe('test-connector');
    expect(processedLog?.tenantId).toBe('tenant-log');
    expect(typeof processedLog?.latencyMs).toBe('number');
    expect(processedLog?.outcome).toBe('processed');

    expect(dedupeLog?.correlationId).toBeDefined();
    expect(dedupeLog?.dedupeKey).toBe('dedupe:log-2');
    expect(dedupeLog?.capabilityId).toBe('inbound_messages');
    expect(dedupeLog?.service).toBe('test-connector');
    expect(dedupeLog?.connector).toBe('test-connector');
    expect(dedupeLog?.tenantId).toBe('tenant-log');
    expect(typeof dedupeLog?.latencyMs).toBe('number');
    expect(dedupeLog?.outcome).toBe('deduped');

    logSpy.mockRestore();
  });

  it('emits metrics for processed, deduped and failed items', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const handler = vi.fn(async (payload: { id: string }) => {
      if (payload.id === 'fail') {
        throw new Error('boom');
      }
    });
    const registry: CapabilityRegistry = { inbound_messages: handler };
    const dedupeStore: DedupeStore = {
      checkAndMark: vi
        .fn()
        .mockResolvedValueOnce(false) // process first item
        .mockResolvedValueOnce(true) // dedupe second
        .mockResolvedValueOnce(false) // fail third
    };

    const { handlePost } = buildWebhookHandlers({
      manifest: testManifest,
      registry,
      dedupeStore,
      parseEvents: async () => [
        makeEvent('ok-1', { dedupeKey: 'k1', correlationId: 'corr-metrics', tenant: 'tenant-metrics' }),
        makeEvent('dup', { dedupeKey: 'k2', correlationId: 'corr-metrics', tenant: 'tenant-metrics' }),
        makeEvent('fail', { dedupeKey: 'k3', correlationId: 'corr-metrics', tenant: 'tenant-metrics', payload: { id: 'fail' } })
      ]
    });

    const response = await handlePost(makeRequest());
    expect(response.status).toBe(200);

    const logs = logSpy.mock.calls
      .map(([entry]) => {
        try {
          return JSON.parse(entry as string);
        } catch {
          return null;
        }
      })
      .filter(Boolean) as Record<string, unknown>[];

    const processedMetric = logs.find((log) => log['metric'] === 'event_processed_total' && log['dedupeKey'] === 'k1');
    expect(processedMetric).toMatchObject({
      capabilityId: 'inbound_messages',
      connector: 'test-connector',
      outcome: 'processed'
    });

    const dedupedMetric = logs.find((log) => log['metric'] === 'event_deduped_total' && log['dedupeKey'] === 'k2');
    expect(dedupedMetric).toMatchObject({
      capabilityId: 'inbound_messages',
      outcome: 'deduped'
    });

    const failedMetric = logs.find((log) => log['metric'] === 'event_failed_total' && log['dedupeKey'] === 'k3');
    expect(failedMetric).toMatchObject({
      capabilityId: 'inbound_messages',
      outcome: 'failed',
      errorCode: 'HANDLER_FAILED'
    });

    const latencyMetrics = logs.filter((log) => log['metric'] === 'handler_latency_ms');
    expect(latencyMetrics).toHaveLength(3);
    expect(latencyMetrics.every((metric) => typeof metric['value'] === 'number')).toBe(true);

    logSpy.mockRestore();
  });
});

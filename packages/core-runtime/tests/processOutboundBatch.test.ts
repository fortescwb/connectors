import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { OutboundMessageIntent } from '@connectors/core-messaging';

import { processOutboundBatch, type DedupeStore, type OutboundSendFn } from '../src/index.js';

const makeIntent = (overrides: Partial<OutboundMessageIntent> = {}): OutboundMessageIntent => ({
  intentId: randomUUID(),
  tenantId: 'tenant-test',
  provider: 'whatsapp',
  to: '+15551234567',
  payload: { type: 'text', text: 'test message' },
  dedupeKey: `dedupe:${randomUUID()}`,
  correlationId: randomUUID(),
  createdAt: new Date().toISOString(),
  ...overrides
});

const createMockDedupeStore = (): DedupeStore => ({
  checkAndMark: vi.fn().mockResolvedValue(false)
});

const createMockLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
});

describe('processOutboundBatch', () => {
  it('processes empty batch successfully', async () => {
    const sendMessage: OutboundSendFn = vi.fn().mockResolvedValue({ messageId: 'msg-1' });
    const dedupeStore = createMockDedupeStore();

    const result = await processOutboundBatch([], sendMessage, { dedupeStore });

    expect(result.summary).toEqual({ total: 0, sent: 0, deduped: 0, failed: 0 });
    expect(result.results).toEqual([]);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('sends all unique intents successfully', async () => {
    const sendMessage: OutboundSendFn = vi.fn().mockResolvedValue({ messageId: 'msg-1' });
    const dedupeStore = createMockDedupeStore();
    const intents = [makeIntent(), makeIntent(), makeIntent()];

    const result = await processOutboundBatch(intents, sendMessage, { dedupeStore });

    expect(result.summary).toEqual({ total: 3, sent: 3, deduped: 0, failed: 0 });
    expect(result.results).toHaveLength(3);
    expect(result.results.every((r) => r.status === 'sent')).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(3);
  });

  it('deduplicates intents correctly', async () => {
    const sendMessage: OutboundSendFn = vi.fn().mockResolvedValue({ messageId: 'msg-1' });
    const checkAndMark = vi
      .fn()
      .mockResolvedValueOnce(false) // First intent is unique
      .mockResolvedValueOnce(true) // Second intent is duplicate
      .mockResolvedValueOnce(false); // Third intent is unique

    const dedupeStore: DedupeStore = { checkAndMark };
    const intents = [makeIntent(), makeIntent(), makeIntent()];

    const result = await processOutboundBatch(intents, sendMessage, { dedupeStore });

    expect(result.summary).toEqual({ total: 3, sent: 2, deduped: 1, failed: 0 });
    expect(result.results[0]?.status).toBe('sent');
    expect(result.results[1]?.status).toBe('deduped');
    expect(result.results[2]?.status).toBe('sent');
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('continues processing when send fails', async () => {
    const sendMessage: OutboundSendFn = vi
      .fn()
      .mockResolvedValueOnce({ messageId: 'msg-1' })
      .mockRejectedValueOnce(new Error('Send failed'))
      .mockResolvedValueOnce({ messageId: 'msg-3' });

    const dedupeStore = createMockDedupeStore();
    const intents = [makeIntent(), makeIntent(), makeIntent()];

    const result = await processOutboundBatch(intents, sendMessage, { dedupeStore });

    expect(result.summary).toEqual({ total: 3, sent: 2, deduped: 0, failed: 1 });
    expect(result.results[0]?.status).toBe('sent');
    expect(result.results[1]?.status).toBe('failed');
    expect(result.results[1]?.errorCode).toBe('send_failed');
    expect(result.results[1]?.errorMessage).toBe('Send failed');
    expect(result.results[2]?.status).toBe('sent');
    expect(sendMessage).toHaveBeenCalledTimes(3);
  });

  it('handles dedupe error with fail mode "open" (blocks send)', async () => {
    const sendMessage: OutboundSendFn = vi.fn().mockResolvedValue({ messageId: 'msg-1' });
    const checkAndMark = vi.fn().mockRejectedValue(new Error('Redis connection failed'));
    const dedupeStore: DedupeStore = { checkAndMark };
    const logger = createMockLogger();

    const intents = [makeIntent()];

    const result = await processOutboundBatch(intents, sendMessage, {
      dedupeStore,
      dedupeFailMode: 'open',
      logger
    });

    expect(result.summary).toEqual({ total: 1, sent: 0, deduped: 1, failed: 0 });
    expect(result.results[0]?.status).toBe('deduped');
    expect(result.results[0]?.errorCode).toBe('dedupe_error_blocked');
    expect(result.results[0]?.errorMessage).toBe('Redis connection failed');
    expect(sendMessage).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'Dedupe store error',
      expect.objectContaining({
        status: 'deduped',
        errorCode: 'dedupe_error_blocked'
      })
    );
  });

  it('handles dedupe error with fail mode "closed" (allows send)', async () => {
    const sendMessage: OutboundSendFn = vi.fn().mockResolvedValue({ messageId: 'msg-1' });
    const checkAndMark = vi.fn().mockRejectedValue(new Error('Redis connection failed'));
    const dedupeStore: DedupeStore = { checkAndMark };
    const logger = createMockLogger();

    const intents = [makeIntent()];

    const result = await processOutboundBatch(intents, sendMessage, {
      dedupeStore,
      dedupeFailMode: 'closed',
      logger
    });

    expect(result.summary).toEqual({ total: 1, sent: 1, deduped: 0, failed: 0 });
    expect(result.results[0]?.status).toBe('sent');
    expect(result.results[0]?.errorCode).toBe('dedupe_error_allowed');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'Dedupe store error',
      expect.objectContaining({
        status: 'sent',
        errorCode: 'dedupe_error_allowed'
      })
    );
  });

  it('defaults to fail mode "open" when not specified', async () => {
    const sendMessage: OutboundSendFn = vi.fn().mockResolvedValue({ messageId: 'msg-1' });
    const checkAndMark = vi.fn().mockRejectedValue(new Error('Redis error'));
    const dedupeStore: DedupeStore = { checkAndMark };

    const intents = [makeIntent()];

    const result = await processOutboundBatch(intents, sendMessage, { dedupeStore });

    expect(result.summary).toEqual({ total: 1, sent: 0, deduped: 1, failed: 0 });
    expect(result.results[0]?.status).toBe('deduped');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('logs correctly with correlationId and dedupeKey', async () => {
    const sendMessage: OutboundSendFn = vi.fn().mockResolvedValue({ messageId: 'msg-1' });
    const dedupeStore = createMockDedupeStore();
    const logger = createMockLogger();

    const intent = makeIntent({ correlationId: 'corr-123', dedupeKey: 'dedupe-456' });

    await processOutboundBatch([intent], sendMessage, { dedupeStore, logger });

    expect(logger.info).toHaveBeenCalledWith(
      'Intent sent',
      expect.objectContaining({
        correlationId: 'corr-123',
        dedupeKey: 'dedupe-456',
        status: 'sent'
      })
    );
  });

  it('includes provider response in result', async () => {
    const providerResponse = { messageId: 'wamid.12345', status: 'delivered' };
    const sendMessage: OutboundSendFn = vi.fn().mockResolvedValue(providerResponse);
    const dedupeStore = createMockDedupeStore();

    const intents = [makeIntent()];

    const result = await processOutboundBatch(intents, sendMessage, { dedupeStore });

    expect(result.results[0]?.providerResponse).toEqual(providerResponse);
  });

  it('uses custom dedupe TTL when provided', async () => {
    const sendMessage: OutboundSendFn = vi.fn().mockResolvedValue({ messageId: 'msg-1' });
    const checkAndMark = vi.fn().mockResolvedValue(false);
    const dedupeStore: DedupeStore = { checkAndMark };

    const intents = [makeIntent()];
    const customTtl = 60000; // 60 seconds

    await processOutboundBatch(intents, sendMessage, {
      dedupeStore,
      dedupeTtlMs: customTtl
    });

    expect(checkAndMark).toHaveBeenCalledWith(expect.any(String), customTtl);
  });

  it('masks phone numbers in logs', async () => {
    const sendMessage: OutboundSendFn = vi.fn().mockResolvedValue({ messageId: 'msg-1' });
    const dedupeStore = createMockDedupeStore();
    const logger = createMockLogger();

    const intent = makeIntent({ to: '+15551234567' });

    await processOutboundBatch([intent], sendMessage, { dedupeStore, logger });

    expect(logger.info).toHaveBeenCalledWith(
      'Intent sent',
      expect.objectContaining({
        toMasked: '***4567'
      })
    );
  });

  it('tracks correct summary counts for mixed results', async () => {
    const sendMessage: OutboundSendFn = vi
      .fn()
      .mockResolvedValueOnce({ messageId: 'msg-1' })
      .mockRejectedValueOnce(new Error('Send failed'))
      .mockResolvedValueOnce({ messageId: 'msg-3' })
      .mockResolvedValueOnce({ messageId: 'msg-4' });

    const checkAndMark = vi
      .fn()
      .mockResolvedValueOnce(false) // unique
      .mockResolvedValueOnce(false) // unique (will fail)
      .mockResolvedValueOnce(true) // duplicate
      .mockResolvedValueOnce(false); // unique

    const dedupeStore: DedupeStore = { checkAndMark };
    const intents = [makeIntent(), makeIntent(), makeIntent(), makeIntent()];

    const result = await processOutboundBatch(intents, sendMessage, { dedupeStore });

    expect(result.summary).toEqual({ total: 4, sent: 2, deduped: 1, failed: 1 });
    expect(result.results).toHaveLength(4);
  });

  it('provides logger context to sendMessage function', async () => {
    const sendMessage: OutboundSendFn = vi.fn().mockImplementation(async (_intent, ctx) => {
      ctx.logger.info('Sending message');
      return { messageId: 'msg-1' };
    });

    const dedupeStore = createMockDedupeStore();
    const logger = createMockLogger();
    const intents = [makeIntent()];

    await processOutboundBatch(intents, sendMessage, { dedupeStore, logger });

    expect(sendMessage).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        logger: expect.objectContaining({
          info: expect.any(Function),
          warn: expect.any(Function),
          error: expect.any(Function)
        })
      })
    );
  });
});

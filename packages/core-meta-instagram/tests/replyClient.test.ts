import { describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { InMemoryDedupeStore } from '@connectors/core-runtime';

import { sendCommentReplyBatch } from '../src/index.js';

const createStore = () => new InMemoryDedupeStore();

function createCommand(overrides: Partial<Parameters<typeof sendCommentReplyBatch>[0][number]> = {}) {
  return {
    externalCommentId: 'comment-default',
    externalPostId: 'post-default',
    pageId: 'page-default',
    platform: 'instagram',
    content: { type: 'text', text: 'Thanks for your comment!' },
    tenantId: 'tenant-1',
    idempotencyKey: 'reply-default',
    ...overrides
  };
}

function createTransport({ status = 200, body = { id: 'reply_1' } } = {}) {
  const fn = vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' }
    })
  );
  return fn;
}

describe('sendCommentReplyBatch', () => {
  it('throws when idempotencyKey is missing to prevent unstable dedupe keys', async () => {
    const transport = createTransport();
    const dedupeStore = createStore();

    await expect(
      sendCommentReplyBatch(
        [
          // @ts-expect-error intentional: validating runtime guard when idempotencyKey is omitted
          createCommand({ idempotencyKey: undefined })
        ],
        { accessToken: 'token', transport, dedupeStore, apiBaseUrl: 'https://graph.facebook.com' }
      )
    ).rejects.toThrow(/idempotencyKey/);
  });

  it('sends a reply with dedupe and returns reply id', async () => {
    const transport = createTransport();
    const dedupeStore = createStore();
    const results = await sendCommentReplyBatch(
      [createCommand({ externalCommentId: '1789_comment_1', externalPostId: '1789_post_1', idempotencyKey: 'reply-1' })],
      {
        accessToken: 'token',
        transport,
        dedupeStore,
        apiBaseUrl: 'https://graph.facebook.com'
      }
    );

    expect(results[0].success).toBe(true);
    expect(results[0].externalReplyId).toBe('reply_1');
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('dedupes repeated command with same idempotencyKey and commentId across calls', async () => {
    const transport = createTransport();
    const dedupeStore = createStore();
    const command = createCommand({
      externalCommentId: '1789_comment_dup',
      externalPostId: '1789_post',
      content: { type: 'text', text: 'Thanks!' },
      idempotencyKey: 'reply-dedupe'
    });

    const first = await sendCommentReplyBatch([command], {
      accessToken: 'token',
      transport,
      dedupeStore,
      apiBaseUrl: 'https://graph.facebook.com'
    });
    const second = await sendCommentReplyBatch([command], {
      accessToken: 'token',
      transport,
      dedupeStore,
      apiBaseUrl: 'https://graph.facebook.com'
    });

    expect(first[0].success).toBe(true);
    expect(first[0].errorCode).toBeUndefined();
    expect(second[0].success).toBe(true);
    expect(second[0].errorCode).toBe('deduped');
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('dedupes even when idempotencyKey differs for the same comment', async () => {
    const transport = createTransport();
    const dedupeStore = createStore();
    const commandBase = {
      externalCommentId: '1789_comment_same',
      externalPostId: '1789_post',
      content: { type: 'text', text: 'Variant reply' }
    } as const;

    await sendCommentReplyBatch(
      [createCommand({ ...commandBase, idempotencyKey: 'reply-variant-1' })],
      { accessToken: 'token', transport, dedupeStore, apiBaseUrl: 'https://graph.facebook.com' }
    );
    await sendCommentReplyBatch(
      [createCommand({ ...commandBase, idempotencyKey: 'reply-variant-2' })],
      { accessToken: 'token', transport, dedupeStore, apiBaseUrl: 'https://graph.facebook.com' }
    );

    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('does not dedupe when commentId differs even with same idempotencyKey', async () => {
    const transport = createTransport();
    const dedupeStore = createStore();

    await sendCommentReplyBatch(
      [createCommand({ externalCommentId: 'comment-a', idempotencyKey: 'shared-idem', content: { type: 'text', text: 'First' } })],
      { accessToken: 'token', transport, dedupeStore, apiBaseUrl: 'https://graph.facebook.com' }
    );
    await sendCommentReplyBatch(
      [createCommand({ externalCommentId: 'comment-b', idempotencyKey: 'shared-idem', content: { type: 'text', text: 'Second' } })],
      { accessToken: 'token', transport, dedupeStore, apiBaseUrl: 'https://graph.facebook.com' }
    );

    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('retries on 500 and succeeds on second attempt', async () => {
    vi.useFakeTimers();
    const responses = [500, 200];
    const transport = vi.fn(async () => {
      const status = responses.shift() ?? 500;
      return new Response(JSON.stringify({ id: 'reply_after_retry' }), { status, headers: { 'Content-Type': 'application/json' } });
    });
    const dedupeStore = createStore();

    const promise = sendCommentReplyBatch(
      [
        createCommand({
          externalCommentId: '1789_comment_retry',
          externalPostId: '1789_post_retry',
          content: { type: 'text', text: 'Retry message' },
          idempotencyKey: 'reply-retry'
        })
      ],
      {
        accessToken: 'token',
        transport,
        dedupeStore,
        apiBaseUrl: 'https://graph.facebook.com',
        retry: { attempts: 3, backoffMs: 5 }
      }
    );

    await vi.runAllTimersAsync();
    const results = await promise;
    expect(results[0].success).toBe(true);
    expect(results[0].externalReplyId).toBe('reply_after_retry');
    expect(transport).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('fails with timeout and does not duplicate sends after retries', async () => {
    vi.useFakeTimers();
    const transport = vi.fn(async () => {
      throw new Error('timeout');
    });
    const dedupeStore = createStore();

    const promise = sendCommentReplyBatch(
      [
        createCommand({
          externalCommentId: '1789_comment_timeout',
          externalPostId: '1789_post_timeout',
          content: { type: 'text', text: 'Timeout message' },
          idempotencyKey: 'reply-timeout'
        })
      ],
      {
        accessToken: 'token',
        transport,
        dedupeStore,
        retry: { attempts: 2, backoffMs: 10 },
        apiBaseUrl: 'https://graph.facebook.com'
      }
    );

    await vi.runAllTimersAsync();
    const results = await promise;
    expect(results[0].success).toBe(false);
    expect(results[0].errorCode).toBe('timeout');
    expect(transport).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  describe('integration with HTTP transport', () => {
    it('dedupes reprocessing of the same comment even if idempotencyKey changes', async () => {
      const attempts: Array<{ headers: Record<string, unknown>; body: string }> = [];
      const server = createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
          attempts.push({ headers: req.headers as Record<string, unknown>, body: Buffer.concat(chunks).toString() });
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ id: `reply_${attempts.length}` }));
        });
      });

      await new Promise<void>((resolve) => server.listen(0, resolve));
      const address = server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const dedupeStore = createStore();

      try {
        const command = createCommand({
          externalCommentId: 'integration-comment-1',
          externalPostId: 'post-int-1',
          pageId: 'page-int-1',
          idempotencyKey: 'idem-first'
        });

        const first = await sendCommentReplyBatch([command], {
          accessToken: 'token',
          dedupeStore,
          apiBaseUrl: baseUrl
        });
        const second = await sendCommentReplyBatch(
          [{ ...command, idempotencyKey: 'idem-retry-new' }],
          {
            accessToken: 'token',
            dedupeStore,
            apiBaseUrl: baseUrl
          }
        );

        expect(first[0].success).toBe(true);
        expect(second[0].errorCode).toBe('deduped');
        expect(attempts).toHaveLength(1);
        expect(attempts[0]?.headers['idempotency-key']).toBe('idem-first');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it('retries with a stable Idempotency-Key header', async () => {
      const attempts: string[] = [];

      const server = createServer((req, res) => {
        attempts.push((req.headers['idempotency-key'] as string | undefined) ?? '');
        const attemptNumber = attempts.length;
        const status = attemptNumber === 1 ? 500 : 200;

        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(status === 200 ? { id: 'reply_after_retry' } : { error: { message: 'temporary' } }));
      });

      await new Promise<void>((resolve) => server.listen(0, resolve));
      const address = server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        const results = await sendCommentReplyBatch(
          [
            createCommand({
              externalCommentId: 'integration-comment-2',
              externalPostId: 'post-int-2',
              pageId: 'page-int-2',
              idempotencyKey: 'idem-stable'
            })
          ],
          {
            accessToken: 'token',
            dedupeStore: createStore(),
            apiBaseUrl: baseUrl,
            retry: { attempts: 2, backoffMs: 5 }
          }
        );

        expect(results[0].success).toBe(true);
        expect(attempts).toHaveLength(2);
        expect(new Set(attempts)).toEqual(new Set(['idem-stable']));
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });

  it('throws when dedupeStore is missing to prevent unsafe outbound use', async () => {
    const transport = createTransport();

    // @ts-expect-error intentional: validating runtime guard when dedupeStore is omitted
    await expect(
      sendCommentReplyBatch(
        [
          {
            externalCommentId: '1789_comment_missing_store',
            externalPostId: '1789_post_missing_store',
            platform: 'instagram',
            content: { type: 'text', text: 'Missing store' },
            tenantId: 'tenant-1',
            idempotencyKey: 'reply-missing-store'
          }
        ],
        {
          accessToken: 'token',
          transport,
          apiBaseUrl: 'https://graph.facebook.com'
        }
      )
    ).rejects.toThrow(/dedupeStore is required/);
  });
});

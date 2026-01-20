import { describe, expect, it, vi } from 'vitest';

import { InMemoryDedupeStore } from '@connectors/core-runtime';

import { sendCommentReplyBatch } from '../src/index.js';

const sharedDedupeStore = new InMemoryDedupeStore();

function createCommand(overrides: Partial<Parameters<typeof sendCommentReplyBatch>[0][number]> = {}) {
  return {
    externalCommentId: 'comment-default',
    externalPostId: 'post-default',
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

    await expect(
      sendCommentReplyBatch(
        [
          // @ts-expect-error intentional: validating runtime guard when idempotencyKey is omitted
          createCommand({ idempotencyKey: undefined })
        ],
        { accessToken: 'token', transport, dedupeStore: sharedDedupeStore, apiBaseUrl: 'https://graph.facebook.com' }
      )
    ).rejects.toThrow(/idempotencyKey/);
  });

  it('sends a reply with dedupe and returns reply id', async () => {
    const transport = createTransport();
    const results = await sendCommentReplyBatch(
      [createCommand({ externalCommentId: '1789_comment_1', externalPostId: '1789_post_1', idempotencyKey: 'reply-1' })],
      {
        accessToken: 'token',
        transport,
        dedupeStore: sharedDedupeStore,
        apiBaseUrl: 'https://graph.facebook.com'
      }
    );

    expect(results[0].success).toBe(true);
    expect(results[0].externalReplyId).toBe('reply_1');
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('dedupes repeated command with same idempotencyKey and commentId across calls', async () => {
    const transport = createTransport();
    const command = createCommand({
      externalCommentId: '1789_comment_dup',
      externalPostId: '1789_post',
      content: { type: 'text', text: 'Thanks!' },
      idempotencyKey: 'reply-dedupe'
    });

    const first = await sendCommentReplyBatch([command], {
      accessToken: 'token',
      transport,
      dedupeStore: sharedDedupeStore,
      apiBaseUrl: 'https://graph.facebook.com'
    });
    const second = await sendCommentReplyBatch([command], {
      accessToken: 'token',
      transport,
      dedupeStore: sharedDedupeStore,
      apiBaseUrl: 'https://graph.facebook.com'
    });

    expect(first[0].success).toBe(true);
    expect(first[0].errorCode).toBeUndefined();
    expect(second[0].success).toBe(true);
    expect(second[0].errorCode).toBe('deduped');
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('does not dedupe when idempotencyKey differs for the same comment', async () => {
    const transport = createTransport();
    const commandBase = {
      externalCommentId: '1789_comment_same',
      externalPostId: '1789_post',
      content: { type: 'text', text: 'Variant reply' }
    } as const;

    await sendCommentReplyBatch(
      [createCommand({ ...commandBase, idempotencyKey: 'reply-variant-1' })],
      { accessToken: 'token', transport, dedupeStore: sharedDedupeStore, apiBaseUrl: 'https://graph.facebook.com' }
    );
    await sendCommentReplyBatch(
      [createCommand({ ...commandBase, idempotencyKey: 'reply-variant-2' })],
      { accessToken: 'token', transport, dedupeStore: sharedDedupeStore, apiBaseUrl: 'https://graph.facebook.com' }
    );

    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('does not dedupe when commentId differs even with same idempotencyKey', async () => {
    const transport = createTransport();

    await sendCommentReplyBatch(
      [createCommand({ externalCommentId: 'comment-a', idempotencyKey: 'shared-idem', content: { type: 'text', text: 'First' } })],
      { accessToken: 'token', transport, dedupeStore: sharedDedupeStore, apiBaseUrl: 'https://graph.facebook.com' }
    );
    await sendCommentReplyBatch(
      [createCommand({ externalCommentId: 'comment-b', idempotencyKey: 'shared-idem', content: { type: 'text', text: 'Second' } })],
      { accessToken: 'token', transport, dedupeStore: sharedDedupeStore, apiBaseUrl: 'https://graph.facebook.com' }
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
        dedupeStore: sharedDedupeStore,
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
        dedupeStore: sharedDedupeStore,
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

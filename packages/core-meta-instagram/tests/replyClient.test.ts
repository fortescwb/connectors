import { describe, expect, it, vi } from 'vitest';

import { InMemoryDedupeStore } from '@connectors/core-runtime';

import { sendCommentReplyBatch } from '../src/index.js';

function createHttpClient({ status = 200, body = { id: 'reply_1' } } = {}) {
  const fn = vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' }
    })
  );
  return fn;
}

describe('sendCommentReplyBatch', () => {
  it('sends a reply with dedupe and returns reply id', async () => {
    const httpClient = createHttpClient();
    const dedupeStore = new InMemoryDedupeStore();
    const results = await sendCommentReplyBatch(
      [
        {
          externalCommentId: '1789_comment_1',
          externalPostId: '1789_post_1',
          platform: 'instagram',
          content: { type: 'text', text: 'Thanks for your comment!' },
          tenantId: 'tenant-1'
        }
      ],
      {
        accessToken: 'token',
        httpClient,
        dedupeStore,
        apiBaseUrl: 'https://graph.facebook.com/v19.0'
      }
    );

    expect(results[0].success).toBe(true);
    expect(results[0].externalReplyId).toBe('reply_1');
    expect(httpClient).toHaveBeenCalledTimes(1);
  });

  it('dedupes repeated command and does not send twice', async () => {
    const httpClient = createHttpClient();
    const dedupeStore = new InMemoryDedupeStore();
    const command = {
      externalCommentId: '1789_comment_dup',
      externalPostId: '1789_post',
      platform: 'instagram',
      content: { type: 'text', text: 'Thanks!' },
      tenantId: 'tenant-1'
    } as const;

    const first = await sendCommentReplyBatch([command], {
      accessToken: 'token',
      httpClient,
      dedupeStore,
      apiBaseUrl: 'https://graph.facebook.com/v19.0'
    });
    const second = await sendCommentReplyBatch([command], {
      accessToken: 'token',
      httpClient,
      dedupeStore,
      apiBaseUrl: 'https://graph.facebook.com/v19.0'
    });

    expect(first[0].success).toBe(true);
    expect(second[0].success).toBe(true);
    expect(second[0].errorCode).toBe('deduped');
    expect(httpClient).toHaveBeenCalledTimes(1);
  });

  it('retries on 500 and succeeds on second attempt', async () => {
    const responses = [500, 200];
    const httpClient = vi.fn(async () => {
      const status = responses.shift() ?? 500;
      return new Response(JSON.stringify({ id: 'reply_after_retry' }), { status, headers: { 'Content-Type': 'application/json' } });
    });

    const results = await sendCommentReplyBatch(
      [
        {
          externalCommentId: '1789_comment_retry',
          externalPostId: '1789_post_retry',
          platform: 'instagram',
          content: { type: 'text', text: 'Retry message' },
          tenantId: 'tenant-1'
        }
      ],
      {
        accessToken: 'token',
        httpClient,
        apiBaseUrl: 'https://graph.facebook.com/v19.0'
      }
    );

    expect(results[0].success).toBe(true);
    expect(results[0].externalReplyId).toBe('reply_after_retry');
    expect(httpClient).toHaveBeenCalledTimes(2);
  });

  it('fails with timeout and does not duplicate sends after retries', async () => {
    const httpClient = vi.fn(async () => {
      throw new Error('timeout');
    });

    const results = await sendCommentReplyBatch(
      [
        {
          externalCommentId: '1789_comment_timeout',
          externalPostId: '1789_post_timeout',
          platform: 'instagram',
          content: { type: 'text', text: 'Timeout message' },
          tenantId: 'tenant-1'
        }
      ],
      {
        accessToken: 'token',
        httpClient,
        retry: { attempts: 2, backoffMs: 10 },
        apiBaseUrl: 'https://graph.facebook.com/v19.0'
      }
    );

    expect(results[0].success).toBe(false);
    expect(results[0].errorCode).toBe('timeout');
    expect(httpClient).toHaveBeenCalledTimes(2);
  });
});

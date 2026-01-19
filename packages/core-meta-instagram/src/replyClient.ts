import { createLogger, type Logger } from '@connectors/core-logging';
import { type DedupeStore } from '@connectors/core-runtime';
import { buildCommentReplyDedupeKey, CommentReplyCommandSchema, type CommentReplyCommand } from '@connectors/core-comments';

export interface HttpClient {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface SendCommentReplyBatchOptions {
  accessToken: string;
  httpClient?: HttpClient;
  dedupeStore: DedupeStore;
  dedupeTtlMs?: number;
  logger?: Logger;
  apiBaseUrl?: string;
  retry?: {
    attempts?: number;
    backoffMs?: number;
  };
}

export interface SendCommentReplyResult {
  success: boolean;
  externalReplyId?: string;
  status?: number;
  errorCode?: string;
  errorMessage?: string;
}

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BACKOFF_MS = 200;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build dedupe key for comment reply.
 */
function buildDedupeKey(command: CommentReplyCommand): string {
  if (!command.idempotencyKey) {
    throw new Error('idempotencyKey is required for comment replies to ensure stable dedupe keys');
  }

  return buildCommentReplyDedupeKey(command.platform, command.tenantId, command.externalCommentId, command.idempotencyKey);
}

async function sendOnce(
  command: CommentReplyCommand,
  opts: Required<Pick<SendCommentReplyBatchOptions, 'accessToken' | 'httpClient' | 'apiBaseUrl'>>
): Promise<Response> {
  const url = `${opts.apiBaseUrl}/${command.externalCommentId}/replies`;
  const body = new URLSearchParams({ message: command.content.text });
  return opts.httpClient(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });
}

async function sendWithRetry(command: CommentReplyCommand, opts: Required<SendCommentReplyBatchOptions>): Promise<SendCommentReplyResult> {
  const attempts = opts.retry?.attempts ?? DEFAULT_ATTEMPTS;
  const backoffMs = opts.retry?.backoffMs ?? DEFAULT_BACKOFF_MS;
  const logger = opts.logger ?? createLogger({ service: 'core-meta-instagram', component: 'comment-reply' });

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await sendOnce(command, { accessToken: opts.accessToken, httpClient: opts.httpClient!, apiBaseUrl: opts.apiBaseUrl! });
      const status = response.status;
      if (status >= 200 && status < 300) {
        const json = (await response.json().catch(() => ({}))) as { id?: string };
        return { success: true, externalReplyId: json.id, status };
      }

      if (status === 400 || status === 403) {
        return { success: false, status, errorCode: 'client_error', errorMessage: `status_${status}` };
      }

      if (attempt === attempts) {
        return { success: false, status, errorCode: 'retry_exhausted', errorMessage: `status_${status}` };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isTimeout = message.toLowerCase().includes('timeout');
      if (attempt === attempts) {
        logger.warn('Comment reply failed after retries', { error: message, attempt, attempts });
        return { success: false, errorCode: isTimeout ? 'timeout' : 'network_error', errorMessage: message };
      }
    }

    await delay(backoffMs * attempt);
  }

  return { success: false, errorCode: 'unknown' };
}

export async function sendCommentReplyBatch(
  commands: CommentReplyCommand[],
  options: SendCommentReplyBatchOptions
): Promise<SendCommentReplyResult[]> {
  if (!options.dedupeStore) {
    throw new Error('dedupeStore is required for outbound side-effects to preserve exactly-once semantics');
  }

  const httpClient = options.httpClient ?? fetch;
  const apiBaseUrl = options.apiBaseUrl ?? 'https://graph.facebook.com/v19.0';
  const dedupeStore = options.dedupeStore;
  const dedupeTtlMs = options.dedupeTtlMs ?? 24 * 60 * 60 * 1000;
  const logger = options.logger ?? createLogger({ service: 'core-meta-instagram', component: 'comment-reply' });

  const validated = commands.map((cmd) => CommentReplyCommandSchema.parse(cmd));
  const results: SendCommentReplyResult[] = [];

  for (const command of validated) {
    const dedupeKey = buildDedupeKey(command);
    let isDuplicate = false;
    try {
      isDuplicate = await dedupeStore.checkAndMark(dedupeKey, dedupeTtlMs);
    } catch (error) {
      logger.warn('Dedupe store error (allowing send)', { error: (error as Error).message });
    }

    if (isDuplicate) {
      results.push({ success: true, externalReplyId: undefined, status: 200, errorCode: 'deduped' });
      continue;
    }

    const result = await sendWithRetry(command, {
      accessToken: options.accessToken,
      httpClient,
      apiBaseUrl,
      dedupeStore,
      dedupeTtlMs,
      logger,
      retry: options.retry ?? { attempts: DEFAULT_ATTEMPTS, backoffMs: DEFAULT_BACKOFF_MS }
    });
    results.push(result);
  }

  return results;
}

import { createGraphClient, MetaGraphError, type GraphClient, type GraphTransport } from '@connectors/core-meta-graph';
import { createLogger, type Logger } from '@connectors/core-logging';
import { type DedupeStore } from '@connectors/core-runtime';
import { buildCommentReplyDedupeKey, CommentReplyCommandSchema, type CommentReplyCommand } from '@connectors/core-comments';

export interface SendCommentReplyBatchOptions {
  accessToken: string;
  httpClient?: GraphTransport;
  transport?: GraphTransport;
  graphClient?: GraphClient;
  dedupeStore: DedupeStore;
  dedupeTtlMs?: number;
  logger?: Logger;
  apiBaseUrl?: string;
  retry?: {
    attempts?: number;
    backoffMs?: number;
  };
  timeoutMs?: number;
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

/**
 * Build dedupe key for comment reply.
 */
function buildDedupeKey(command: CommentReplyCommand): string {
  if (!command.idempotencyKey) {
    throw new Error('idempotencyKey is required for comment replies to ensure stable dedupe keys');
  }

  return buildCommentReplyDedupeKey(command.platform, command.tenantId, command.externalCommentId, command.idempotencyKey);
}

function mapRetry(retry?: SendCommentReplyBatchOptions['retry']) {
  const attempts = retry?.attempts ?? DEFAULT_ATTEMPTS;
  const backoffMs = retry?.backoffMs ?? DEFAULT_BACKOFF_MS;
  return {
    initialDelayMs: backoffMs,
    maxDelayMs: backoffMs * 8,
    multiplier: 2,
    jitter: false,
    maxRetries: Math.max(0, attempts - 1)
  };
}

async function sendCommentReply(
  command: CommentReplyCommand,
  client: GraphClient,
  logger: Logger
): Promise<SendCommentReplyResult> {
  try {
    const response = await client.post<{ id?: string }>(`${command.externalCommentId}/replies`, new URLSearchParams({ message: command.content.text }), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    const status = response.status;
    const json = (response.data as { id?: string } | undefined) ?? {};
    return { success: true, externalReplyId: json.id, status };
  } catch (error) {
    if (error instanceof MetaGraphError) {
      if (error.code === 'client_error' || error.code === 'auth_error') {
        return { success: false, status: error.status, errorCode: 'client_error', errorMessage: error.message };
      }

      if (error.code === 'timeout') {
        return { success: false, status: error.status, errorCode: 'timeout', errorMessage: error.message };
      }

      if (error.code === 'network_error') {
        return { success: false, status: error.status, errorCode: 'network_error', errorMessage: error.message };
      }

      logger.warn('Meta Graph retry exhausted for comment reply', {
        status: error.status,
        graphCode: error.graphCode,
        graphSubcode: error.graphSubcode,
        fbtraceId: error.fbtraceId
      });
      return { success: false, status: error.status, errorCode: 'retry_exhausted', errorMessage: error.message };
    }

    const message = error instanceof Error ? error.message : String(error);
    logger.warn('Meta Graph transport failure for comment reply', { error: message });
    return { success: false, errorCode: 'network_error', errorMessage: message };
  }
}

export async function sendCommentReplyBatch(
  commands: CommentReplyCommand[],
  options: SendCommentReplyBatchOptions
): Promise<SendCommentReplyResult[]> {
  if (!options.dedupeStore) {
    throw new Error('dedupeStore is required for outbound side-effects to preserve exactly-once semantics');
  }

  const transport = options.transport ?? options.httpClient ?? fetch;
  const apiBaseUrl = options.apiBaseUrl ?? 'https://graph.facebook.com';
  const dedupeStore = options.dedupeStore;
  const dedupeTtlMs = options.dedupeTtlMs ?? 24 * 60 * 60 * 1000;
  const logger = options.logger ?? createLogger({ service: 'core-meta-instagram', component: 'comment-reply' });
  const graphClient =
    options.graphClient ??
    createGraphClient({
      accessToken: options.accessToken,
      baseUrl: apiBaseUrl,
      apiVersion: 'v19.0',
      transport,
      retry: mapRetry(options.retry),
      defaultTimeoutMs: options.timeoutMs,
      context: { connector: 'instagram', capabilityId: 'comment_reply', channel: 'instagram' },
      logger
    });

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

    const result = await sendCommentReply(command, graphClient, logger);
    results.push(result);
  }

  return results;
}

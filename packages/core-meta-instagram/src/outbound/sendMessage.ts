import { createLogger, type Logger } from '@connectors/core-logging';
import { sanitizeGraphErrorMessage, type GraphClient, type GraphClientConfig, type GraphTransport } from '@connectors/core-meta-graph';
import {
  type InstagramOutboundMessageIntent,
  InstagramOutboundMessageIntentSchema
} from '@connectors/core-messaging';
import {
  processOutboundBatch,
  type DedupeStore,
  type OutboundBatchResult,
  type OutboundSendFn
} from '@connectors/core-runtime';

import { buildInstagramMessagePayload } from './buildPayload.js';
import { createInstagramGraphClient, uploadAttachmentFromUrl } from '../client.js';

export type UploadMode = 'when_missing' | 'never';

export interface InstagramSendMessageConfig {
  accessToken: string;
  instagramBusinessAccountId: string;
  apiVersion?: string;
  baseUrl?: string;
  graphClient?: GraphClient;
  transport?: GraphTransport;
  timeoutMs?: number;
  retry?: GraphClientConfig['retry'];
  uploadMedia?: UploadMode;
  logger?: Logger;
}

export interface InstagramSendMessageResult<T = unknown> {
  status: number;
  providerMessageId?: string;
  raw?: T;
  attachmentId?: string;
}

async function maybeUploadMedia(
  intent: InstagramOutboundMessageIntent,
  config: InstagramSendMessageConfig,
  logger: Logger
): Promise<string | undefined> {
  const payload = intent.payload;
  if (payload.type === 'text' || payload.type === 'link') {
    return undefined;
  }

  if (payload.mediaId) {
    return payload.mediaId;
  }

  if (config.uploadMedia === 'never' || !payload.url) {
    return undefined;
  }

  const attachmentType = payload.type === 'document' ? 'file' : payload.type;

  try {
    const upload = await uploadAttachmentFromUrl({
      instagramBusinessAccountId: config.instagramBusinessAccountId,
      type: attachmentType,
      url: payload.url,
      apiVersion: config.apiVersion,
      baseUrl: config.baseUrl,
      retry: config.retry,
      timeoutMs: config.timeoutMs,
      transport: config.transport,
      accessToken: config.accessToken,
      graphClient: config.graphClient
    });
    return upload.attachmentId;
  } catch (error) {
    logger.warn('Instagram media upload failed', {
      error: sanitizeGraphErrorMessage(error instanceof Error ? error.message : String(error))
    });
    throw error;
  }
}

export async function sendInstagramMessage<T = unknown>(
  intent: InstagramOutboundMessageIntent,
  config: InstagramSendMessageConfig
): Promise<InstagramSendMessageResult<T>> {
  const validated = InstagramOutboundMessageIntentSchema.parse(intent);
  const logger = config.logger ?? createLogger({ service: 'core-meta-instagram', component: 'outbound' });
  const attachmentId = await maybeUploadMedia(validated, config, logger);
  const graphPayload = buildInstagramMessagePayload(validated, { attachmentId });

  const client =
    config.graphClient ??
    createInstagramGraphClient({
      accessToken: config.accessToken,
      apiVersion: config.apiVersion,
      baseUrl: config.baseUrl,
      retry: config.retry,
      defaultTimeoutMs: config.timeoutMs,
      transport: config.transport,
      correlationId: validated.correlationId,
      capabilityId: 'outbound_messages',
      logger
    });

  const response = await client.post<T>(`${config.instagramBusinessAccountId}/messages`, graphPayload, {
    timeoutMs: config.timeoutMs,
    retry: config.retry
  });

  const data = response.data as unknown;
  const providerMessageId =
    (data as { message_id?: string } | undefined)?.message_id ?? (data as { id?: string } | undefined)?.id;

  return {
    status: response.status,
    providerMessageId,
    raw: data as T | undefined,
    attachmentId
  };
}

export interface InstagramOutboundBatchOptions extends InstagramSendMessageConfig {
  dedupeStore: DedupeStore;
  dedupeTtlMs?: number;
  dedupeFailMode?: 'open' | 'closed';
}

/**
  * Process a batch of outbound Instagram intents with exactly-once semantics.
  */
export async function processInstagramOutbound(
  intents: InstagramOutboundMessageIntent[],
  options: InstagramOutboundBatchOptions
): Promise<OutboundBatchResult<InstagramSendMessageResult>> {
  const sendFn: OutboundSendFn<InstagramOutboundMessageIntent, InstagramSendMessageResult> = (intent) =>
    sendInstagramMessage(intent, options);

  return processOutboundBatch(intents, sendFn, {
    dedupeStore: options.dedupeStore,
    dedupeTtlMs: options.dedupeTtlMs,
    dedupeFailMode: options.dedupeFailMode,
    connectorId: 'instagram',
    capabilityId: 'outbound_messages',
    logger: options.logger
  });
}

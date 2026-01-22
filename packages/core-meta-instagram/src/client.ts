import { createLogger, type Logger } from '@connectors/core-logging';
import {
  createGraphClient,
  type GraphClient,
  type GraphClientConfig,
  type GraphTransport
} from '@connectors/core-meta-graph';

export interface InstagramGraphClientConfig extends Omit<GraphClientConfig, 'context'> {
  capabilityId?: string;
  correlationId?: string;
  logger?: Logger;
}

export function createInstagramGraphClient(config: InstagramGraphClientConfig): GraphClient {
  const logger = config.logger ?? createLogger({ service: 'core-meta-instagram', component: 'graph-client' });

  return createGraphClient({
    ...config,
    logger,
    context: {
      connector: 'instagram',
      capabilityId: config.capabilityId ?? 'outbound_messages',
      channel: 'instagram_dm',
      correlationId: config.correlationId
    }
  });
}

export interface UploadAttachmentOptions {
  instagramBusinessAccountId: string;
  type: 'image' | 'video' | 'audio' | 'file';
  url: string;
  isReusable?: boolean;
  apiVersion?: string;
  baseUrl?: string;
  retry?: GraphClientConfig['retry'];
  timeoutMs?: number;
  transport?: GraphTransport;
  accessToken?: string;
  graphClient?: GraphClient;
}

export interface UploadAttachmentResult<T = unknown> {
  status: number;
  attachmentId?: string;
  raw?: T;
}

/**
 * Upload an attachment by URL to obtain an attachment_id usable in outbound messages.
 * This mirrors the Meta Graph "message_attachments" endpoint for Instagram.
 */
export async function uploadAttachmentFromUrl<T = unknown>(
  options: UploadAttachmentOptions
): Promise<UploadAttachmentResult<T>> {
  if (!options.graphClient && !options.accessToken) {
    throw new Error('accessToken is required to upload attachments when graphClient is not provided');
  }

  const client =
    options.graphClient ??
    createInstagramGraphClient({
      accessToken: options.accessToken ?? '',
      apiVersion: options.apiVersion,
      baseUrl: options.baseUrl,
      retry: options.retry,
      defaultTimeoutMs: options.timeoutMs,
      transport: options.transport,
      correlationId: undefined,
      capabilityId: 'outbound_messages'
    });

  const messagePayload = {
    attachment: {
      type: options.type,
      payload: {
        url: options.url,
        is_reusable: options.isReusable ?? false
      }
    }
  };

  const body = new URLSearchParams({
    message: JSON.stringify(messagePayload)
  });

  const response = await client.post<T>(`${options.instagramBusinessAccountId}/message_attachments`, body, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeoutMs: options.timeoutMs,
    retry: options.retry
  });

  const data = response.data as unknown;
  const attachmentId = (data as { attachment_id?: string } | undefined)?.attachment_id;

  return {
    status: response.status,
    attachmentId,
    raw: data as T | undefined
  };
}

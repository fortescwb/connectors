import { createGraphClient, type GraphClient, type GraphClientConfig, type GraphTransport } from '@connectors/core-meta-graph';
import type { OutboundMessageIntent } from '@connectors/core-messaging';

function buildTextPayload(intent: OutboundMessageIntent) {
  if (intent.payload.type !== 'text') {
    throw new Error(`Unsupported payload type "${intent.payload.type}" for WhatsApp outbound`);
  }

  return {
    messaging_product: 'whatsapp',
    to: intent.to,
    type: 'text',
    text: {
      body: intent.payload.text,
      ...(intent.payload.previewUrl !== undefined ? { preview_url: intent.payload.previewUrl } : {})
    },
    // Client message ID provides idempotency at the provider
    client_msg_id: intent.intentId
  };
}

export interface WhatsAppSendMessageConfig {
  accessToken: string;
  phoneNumberId: string;
  apiVersion?: string;
  baseUrl?: string;
  graphClient?: GraphClient;
  transport?: GraphTransport;
  timeoutMs?: number;
  retry?: GraphClientConfig['retry'];
}

export interface WhatsAppSendMessageResponse<T = unknown> {
  providerMessageId?: string;
  status: number;
  raw: T | undefined;
}

export async function sendMessage<TResponse = unknown>(
  intent: OutboundMessageIntent,
  config: WhatsAppSendMessageConfig
): Promise<WhatsAppSendMessageResponse<TResponse>> {
  const payload = buildTextPayload(intent);

  const client =
    config.graphClient ??
    createGraphClient({
      accessToken: config.accessToken,
      apiVersion: config.apiVersion,
      baseUrl: config.baseUrl,
      transport: config.transport,
      retry: config.retry,
      defaultTimeoutMs: config.timeoutMs,
      context: { connector: 'whatsapp', capabilityId: 'outbound_messages', channel: 'whatsapp' }
    });

  const response = await client.post<TResponse>(`${config.phoneNumberId}/messages`, payload, {
    timeoutMs: config.timeoutMs,
    retry: config.retry
  });

  const raw = response.data;
  const messages = (raw as { messages?: Array<{ id?: string }> } | undefined)?.messages;
  const providerMessageId = Array.isArray(messages) ? messages[0]?.id : undefined;

  return {
    providerMessageId,
    status: response.status,
    raw
  };
}

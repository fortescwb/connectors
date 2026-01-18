import type { OutboundMessageIntent } from '@connectors/core-messaging';

export interface WhatsAppHttpClient {
  post: <T = unknown>(
    url: string,
    body: unknown,
    options: { headers?: Record<string, string>; timeoutMs?: number }
  ) => Promise<{ status: number; data: T }>;
}

export interface WhatsAppSendMessageConfig {
  accessToken: string;
  phoneNumberId: string;
  apiVersion?: string;
  baseUrl?: string;
  httpClient?: WhatsAppHttpClient;
  timeoutMs?: number;
}

export interface WhatsAppSendMessageResponse<T = unknown> {
  providerMessageId?: string;
  status: number;
  raw: T;
}

const defaultHttpClient: WhatsAppHttpClient = {
  post: async <T = unknown>(url: string, body: unknown, options: { headers?: Record<string, string>; timeoutMs?: number }) => {
    const controller = options?.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers ?? {})
      },
      body: JSON.stringify(body),
      signal: controller
    });

    const data = (await response.json().catch(() => undefined)) as T;
    return { status: response.status, data };
  }
};

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

export async function sendMessage<TResponse = unknown>(
  intent: OutboundMessageIntent,
  config: WhatsAppSendMessageConfig
): Promise<WhatsAppSendMessageResponse<TResponse>> {
  const httpClient = config.httpClient ?? defaultHttpClient;
  const apiVersion = config.apiVersion ?? 'v19.0';
  const baseUrl = config.baseUrl ?? 'https://graph.facebook.com';
  const url = `${baseUrl}/${apiVersion}/${config.phoneNumberId}/messages`;

  const payload = buildTextPayload(intent);

  const response = await httpClient.post<TResponse>(url, payload, {
    timeoutMs: config.timeoutMs,
    headers: {
      Authorization: `Bearer ${config.accessToken}`
    }
  });

  if (response.status >= 400) {
    const errorMessage = typeof response.data === 'object' && response.data !== null
      ? JSON.stringify(response.data)
      : String(response.data);
    throw new Error(`WhatsApp send failed with status ${response.status}: ${errorMessage}`);
  }

  const raw = response.data;
  const providerMessageId =
    raw && typeof raw === 'object' && 'messages' in raw && Array.isArray((raw as { messages?: unknown[] }).messages)
      ? (raw as { messages: Array<{ id?: string }> }).messages[0]?.id
      : undefined;

  return {
    providerMessageId,
    status: response.status,
    raw
  };
}

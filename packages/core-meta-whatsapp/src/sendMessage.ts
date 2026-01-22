import { createGraphClient, type GraphClient, type GraphClientConfig, type GraphTransport } from '@connectors/core-meta-graph';
import { createLogger } from '@connectors/core-logging';
import type { OutboundMessageIntent, OutboundMessagePayload } from '@connectors/core-messaging';
import { preprocessOutboundIntent } from './preprocessIntent.js';

const logger = createLogger({ component: 'sendMessage' });

// ─────────────────────────────────────────────────────────────────────────────
// Builders por tipo - cada builder transforma o intent em payload da Graph API
// ─────────────────────────────────────────────────────────────────────────────

function buildTextPayload(intent: OutboundMessageIntent): Record<string, unknown> {
  const payload = intent.payload;
  if (payload.type !== 'text') {
    throw new Error(`buildTextPayload: expected type 'text', got '${payload.type}'`);
  }

  return {
    messaging_product: 'whatsapp',
    to: intent.to,
    type: 'text',
    text: {
      body: payload.text,
      ...(payload.previewUrl !== undefined ? { preview_url: payload.previewUrl } : {})
    },
    client_msg_id: intent.intentId
  };
}

function buildAudioPayload(intent: OutboundMessageIntent): Record<string, unknown> {
  const payload = intent.payload;
  if (payload.type !== 'audio') {
    throw new Error(`buildAudioPayload: expected type 'audio', got '${payload.type}'`);
  }

  const audioBlock: Record<string, string> = {};
  if ('mediaId' in payload && payload.mediaId) {
    audioBlock.id = payload.mediaId;
  } else if ('mediaUrl' in payload && payload.mediaUrl) {
    audioBlock.link = payload.mediaUrl;
  }

  return {
    messaging_product: 'whatsapp',
    to: intent.to,
    type: 'audio',
    audio: audioBlock,
    client_msg_id: intent.intentId
  };
}

function buildDocumentPayload(intent: OutboundMessageIntent): Record<string, unknown> {
  const payload = intent.payload;
  if (payload.type !== 'document') {
    throw new Error(`buildDocumentPayload: expected type 'document', got '${payload.type}'`);
  }

  const docBlock: Record<string, string> = {};
  if ('mediaId' in payload && payload.mediaId) {
    docBlock.id = payload.mediaId;
  } else if ('mediaUrl' in payload && payload.mediaUrl) {
    docBlock.link = payload.mediaUrl;
  }
  if (payload.filename) {
    docBlock.filename = payload.filename;
  }
  if (payload.caption) {
    docBlock.caption = payload.caption;
  }

  return {
    messaging_product: 'whatsapp',
    to: intent.to,
    type: 'document',
    document: docBlock,
    client_msg_id: intent.intentId
  };
}

function buildImagePayload(intent: OutboundMessageIntent): Record<string, unknown> {
  const payload = intent.payload;
  if (payload.type !== 'image') {
    throw new Error(`buildImagePayload: expected type 'image', got '${payload.type}'`);
  }

  const imageBlock: Record<string, string> = {};
  if ('mediaId' in payload && payload.mediaId) {
    imageBlock.id = payload.mediaId;
  } else if ('mediaUrl' in payload && payload.mediaUrl) {
    imageBlock.link = payload.mediaUrl;
  }
  if (payload.caption) {
    imageBlock.caption = payload.caption;
  }

  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: intent.to,
    type: 'image',
    image: imageBlock,
    client_msg_id: intent.intentId
  };
}

function buildVideoPayload(intent: OutboundMessageIntent): Record<string, unknown> {
  const payload = intent.payload;
  if (payload.type !== 'video') {
    throw new Error(`buildVideoPayload: expected type 'video', got '${payload.type}'`);
  }

  const videoBlock: Record<string, string> = {};
  if ('mediaId' in payload && payload.mediaId) {
    videoBlock.id = payload.mediaId;
  } else if ('mediaUrl' in payload && payload.mediaUrl) {
    videoBlock.link = payload.mediaUrl;
  }
  if (payload.caption) {
    videoBlock.caption = payload.caption;
  }

  return {
    messaging_product: 'whatsapp',
    to: intent.to,
    type: 'video',
    video: videoBlock,
    client_msg_id: intent.intentId
  };
}

function buildStickerPayload(intent: OutboundMessageIntent): Record<string, unknown> {
  const payload = intent.payload;
  if (payload.type !== 'sticker') {
    throw new Error(`buildStickerPayload: expected type 'sticker', got '${payload.type}'`);
  }

  const stickerBlock: Record<string, string> = {};
  if ('mediaId' in payload && payload.mediaId) {
    stickerBlock.id = payload.mediaId;
  } else if ('mediaUrl' in payload && payload.mediaUrl) {
    stickerBlock.link = payload.mediaUrl;
  }

  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: intent.to,
    type: 'sticker',
    sticker: stickerBlock,
    client_msg_id: intent.intentId
  };
}

function buildContactsPayload(intent: OutboundMessageIntent): Record<string, unknown> {
  const payload = intent.payload;
  if (payload.type !== 'contacts') {
    throw new Error(`buildContactsPayload: expected type 'contacts', got '${payload.type}'`);
  }

  const contacts = payload.contacts.map(contact => {
    const c: Record<string, unknown> = {};
    // contact.name is already { formatted_name: string, first_name?, last_name? }
    c.name = contact.name;
    if (contact.phones && contact.phones.length > 0) {
      c.phones = contact.phones.map(phone => ({
        phone: phone.phone,
        ...(phone.type ? { type: phone.type } : {})
      }));
    }
    if (contact.emails && contact.emails.length > 0) {
      c.emails = contact.emails.map(email => ({
        email: email.email,
        ...(email.type ? { type: email.type } : {})
      }));
    }
    return c;
  });

  return {
    messaging_product: 'whatsapp',
    to: intent.to,
    type: 'contacts',
    contacts,
    client_msg_id: intent.intentId
  };
}

function buildReactionPayload(intent: OutboundMessageIntent): Record<string, unknown> {
  const payload = intent.payload;
  if (payload.type !== 'reaction') {
    throw new Error(`buildReactionPayload: expected type 'reaction', got '${payload.type}'`);
  }

  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: intent.to,
    type: 'reaction',
    reaction: {
      message_id: payload.messageId,
      emoji: payload.emoji
    },
    client_msg_id: intent.intentId
  };
}

function buildLocationPayload(intent: OutboundMessageIntent): Record<string, unknown> {
  const payload = intent.payload;
  if (payload.type !== 'location') {
    throw new Error(`buildLocationPayload: expected type 'location', got '${payload.type}'`);
  }

  const location: Record<string, unknown> = {
    latitude: payload.latitude,
    longitude: payload.longitude
  };

  if (payload.name) {
    location.name = payload.name;
  }
  if (payload.address) {
    location.address = payload.address;
  }

  return {
    messaging_product: 'whatsapp',
    to: intent.to,
    type: 'location',
    location,
    client_msg_id: intent.intentId
  };
}

function buildTemplatePayload(intent: OutboundMessageIntent): Record<string, unknown> {
  const payload = intent.payload;
  if (payload.type !== 'template') {
    throw new Error(`buildTemplatePayload: expected type 'template', got '${payload.type}'`);
  }

  const template: Record<string, unknown> = {
    name: payload.templateName,
    language: { code: payload.languageCode }
  };

  if (payload.components && payload.components.length > 0) {
    template.components = payload.components.map(comp => {
      const c: Record<string, unknown> = { type: comp.type };
      if (comp.parameters && comp.parameters.length > 0) {
        c.parameters = comp.parameters.map(param => {
          const p: Record<string, unknown> = { type: param.type };
          if (param.type === 'text' && param.text) {
            p.text = param.text;
          } else if (param.type === 'image' && param.image) {
            p.image = param.image;
          } else if (param.type === 'document' && param.document) {
            p.document = param.document;
          } else if (param.type === 'video' && param.video) {
            p.video = param.video;
          }
          return p;
        });
      }
      return c;
    });
  }

  return {
    messaging_product: 'whatsapp',
    to: intent.to,
    type: 'template',
    template,
    client_msg_id: intent.intentId
  };
}

/**
 * Build the appropriate WhatsApp API payload based on intent.payload.type
 * Throws on unsupported types
 */
function buildPayload(intent: OutboundMessageIntent): Record<string, unknown> {
  const payloadType = intent.payload.type;

  switch (payloadType) {
    case 'text':
      return buildTextPayload(intent);
    case 'audio':
      return buildAudioPayload(intent);
    case 'document':
      return buildDocumentPayload(intent);
    case 'image':
      return buildImagePayload(intent);
    case 'video':
      return buildVideoPayload(intent);
    case 'sticker':
      return buildStickerPayload(intent);
    case 'contacts':
      return buildContactsPayload(intent);
    case 'reaction':
      return buildReactionPayload(intent);
    case 'location':
      return buildLocationPayload(intent);
    case 'template':
      return buildTemplatePayload(intent);
    default:
      throw new Error(`Unsupported payload type "${(intent.payload as OutboundMessagePayload).type}" for WhatsApp outbound`);
  }
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
  enableMediaUpload?: boolean; // Auto-upload media from mediaUrl if no mediaId (default: true)
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
  // Pre-process intent: auto-upload media if mediaUrl provided but no mediaId
  let processedIntent = intent;
  if (config.enableMediaUpload !== false) {
    try {
      processedIntent = await preprocessOutboundIntent(intent, {
        accessToken: config.accessToken,
        phoneNumberId: config.phoneNumberId,
        apiVersion: config.apiVersion,
        baseUrl: config.baseUrl,
        timeoutMs: config.timeoutMs
      });
    } catch (err) {
      logger.warn('Media pre-processing failed, attempting to send anyway', {
        intentId: intent.intentId,
        error: err instanceof Error ? err.message : String(err)
      });
      // Continue with original intent if pre-processing fails
    }
  }

  const payload = buildPayload(processedIntent);

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

// ─────────────────────────────────────────────────────────────────────────────
// Mark as read - endpoint separado na API WhatsApp
// ─────────────────────────────────────────────────────────────────────────────

export interface WhatsAppMarkReadConfig {
  accessToken: string;
  phoneNumberId: string;
  apiVersion?: string;
  baseUrl?: string;
  graphClient?: GraphClient;
  transport?: GraphTransport;
  timeoutMs?: number;
  retry?: GraphClientConfig['retry'];
}

export interface WhatsAppMarkReadResponse<T = unknown> {
  success: boolean;
  status: number;
  raw: T | undefined;
}

export type WhatsAppOutboundConfig = WhatsAppSendMessageConfig;

/**
 * Mark a specific message as read in WhatsApp.
 * Uses POST /{phoneNumberId}/messages with status: 'read'
 */
export async function markAsRead<TResponse = unknown>(
  messageId: string,
  config: WhatsAppMarkReadConfig
): Promise<WhatsAppMarkReadResponse<TResponse>> {
  const payload = {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId
  };

  const client =
    config.graphClient ??
    createGraphClient({
      accessToken: config.accessToken,
      apiVersion: config.apiVersion,
      baseUrl: config.baseUrl,
      transport: config.transport,
    retry: config.retry,
    defaultTimeoutMs: config.timeoutMs,
    context: { connector: 'whatsapp', capabilityId: 'mark_read', channel: 'whatsapp' }
  });

  const response = await client.post<TResponse>(`${config.phoneNumberId}/messages`, payload, {
    timeoutMs: config.timeoutMs,
    retry: config.retry
  });

  const raw = response.data;
  const success = (raw as { success?: boolean } | undefined)?.success === true;

  return {
    success,
    status: response.status,
    raw
  };
}

/**
 * Dispatch an outbound intent (message or mark_read) using the canonical union.
 * - For mark_read, delegates to markAsRead() to avoid duplicating payload logic.
 * - For message payloads, delegates to sendMessage() which handles all supported types.
 */
export async function sendWhatsAppOutbound<TResponse = unknown>(
  intent: OutboundMessageIntent,
  config: WhatsAppOutboundConfig
): Promise<WhatsAppSendMessageResponse<TResponse> | WhatsAppMarkReadResponse<TResponse>> {
  if (intent.payload.type === 'mark_read') {
    return markAsRead(intent.payload.messageId, config);
  }

  return sendMessage(intent, config);
}

import type { InstagramOutboundMessageIntent } from '@connectors/core-messaging';

export type InstagramGraphMessagePayload = Record<string, unknown>;

interface BuildPayloadOptions {
  attachmentId?: string;
}

const MESSAGING_TYPE_RESPONSE = 'RESPONSE';

function buildBasePayload(intent: InstagramOutboundMessageIntent, message: Record<string, unknown>): InstagramGraphMessagePayload {
  const payload: InstagramGraphMessagePayload = {
    messaging_type: MESSAGING_TYPE_RESPONSE,
    recipient: { id: intent.to },
    message
  };

  if (intent.correlationId) {
    payload.metadata = intent.correlationId.slice(0, 500);
  }

  return payload;
}

function buildTextPayload(intent: InstagramOutboundMessageIntent): InstagramGraphMessagePayload {
  if (intent.payload.type !== 'text') {
    throw new Error(`buildTextPayload expects type "text", got "${intent.payload.type}"`);
  }

  return buildBasePayload(intent, { text: intent.payload.text });
}

function buildLinkPayload(intent: InstagramOutboundMessageIntent): InstagramGraphMessagePayload {
  if (intent.payload.type !== 'link') {
    throw new Error(`buildLinkPayload expects type "link", got "${intent.payload.type}"`);
  }

  const text = intent.payload.text ? `${intent.payload.text} ${intent.payload.url}`.trim() : intent.payload.url;
  return buildBasePayload(intent, { text });
}

function buildAttachmentPayload(
  intent: InstagramOutboundMessageIntent,
  type: 'image' | 'video' | 'audio' | 'file',
  attachmentId?: string
): InstagramGraphMessagePayload {
  const payload = intent.payload;
  if (
    payload.type !== 'image' &&
    payload.type !== 'video' &&
    payload.type !== 'audio' &&
    payload.type !== 'document'
  ) {
    throw new Error(`buildAttachmentPayload expects media payload, got "${payload.type}"`);
  }

  const attachmentPayload: Record<string, unknown> = {};
  if (attachmentId) {
    attachmentPayload.attachment_id = attachmentId;
  } else if ('url' in payload && payload.url) {
    attachmentPayload.url = payload.url;
  } else {
    throw new Error('Media payload requires attachmentId or url');
  }

  const message: Record<string, unknown> = {
    attachment: {
      type,
      payload: attachmentPayload
    }
  };

  if ('caption' in payload && payload.caption) {
    message.text = payload.caption;
  }
  if ('filename' in payload && payload.filename) {
    message.attachment = {
      type,
      payload: {
        ...attachmentPayload,
        filename: payload.filename
      }
    };
  }

  return buildBasePayload(intent, message);
}

export function buildInstagramMessagePayload(
  intent: InstagramOutboundMessageIntent,
  options: BuildPayloadOptions = {}
): InstagramGraphMessagePayload {
  switch (intent.payload.type) {
    case 'text':
      return buildTextPayload(intent);
    case 'link':
      return buildLinkPayload(intent);
    case 'image':
      return buildAttachmentPayload(intent, 'image', options.attachmentId ?? intent.payload.mediaId);
    case 'video':
      return buildAttachmentPayload(intent, 'video', options.attachmentId ?? intent.payload.mediaId);
    case 'audio':
      return buildAttachmentPayload(intent, 'audio', options.attachmentId ?? intent.payload.mediaId);
    case 'document':
      return buildAttachmentPayload(intent, 'file', options.attachmentId ?? intent.payload.mediaId);
    default:
      throw new Error(`Unsupported Instagram payload type "${(intent.payload as { type: string }).type}"`);
  }
}

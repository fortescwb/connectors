import { createLogger } from '@connectors/core-logging';
import type { OutboundMessageIntent, OutboundMessagePayload } from '@connectors/core-messaging';
import { uploadMediaFromUrl, getMimeTypeFromUrl, type WhatsAppMediaUploadConfig } from './uploadMedia.js';

const logger = createLogger({ component: 'preprocessOutboundIntent' });

/**
 * Media type configuration for automatic upload
 */
const MEDIA_TYPE_REQUIRES_UPLOAD = ['video', 'document', 'sticker', 'image', 'audio'];

/**
 * Pre-process an outbound intent:
 * - If mediaUrl is provided for video/document/sticker and no mediaId exists,
 *   automatically upload to Graph API and populate mediaId
 * - Otherwise, return intent unchanged
 *
 * This ensures that when the interface sends media URLs, they are automatically
 * uploaded and converted to mediaIds before sending to WhatsApp API.
 *
 * @param intent - Outbound message intent (potentially with mediaUrl)
 * @param uploadConfig - Configuration for media upload
 * @returns Modified intent with mediaId populated (or original if no upload needed)
 */
export async function preprocessOutboundIntent(
  intent: OutboundMessageIntent,
  uploadConfig?: WhatsAppMediaUploadConfig
): Promise<OutboundMessageIntent> {
  const payload = intent.payload;

  // Check if this message type supports media and requires upload
  if (!MEDIA_TYPE_REQUIRES_UPLOAD.includes(payload.type)) {
    return intent;
  }

  // For media types, check if we need to upload
  const mediaPayload = payload as any;
  const hasMediaId = mediaPayload.mediaId && mediaPayload.mediaId.length > 0;
  const hasMediaUrl = mediaPayload.mediaUrl && mediaPayload.mediaUrl.length > 0;

  // If mediaId already exists, no need to upload
  if (hasMediaId) {
    logger.info('Intent already has mediaId, skipping upload', {
      intentId: intent.intentId,
      type: payload.type,
      mediaId: mediaPayload.mediaId
    });
    return intent;
  }

  // If no mediaUrl provided, return as-is (will fail validation if neither exists)
  if (!hasMediaUrl) {
    return intent;
  }

  // No upload config provided - can't upload
  if (!uploadConfig) {
    logger.warn('Media URL present but no upload config provided - will attempt to send as-is', {
      intentId: intent.intentId,
      type: payload.type,
      mediaUrl: mediaPayload.mediaUrl.substring(0, 50) + '...'
    });
    return intent;
  }

  // Perform automatic upload
  try {
    logger.info('Auto-uploading media before sending', {
      intentId: intent.intentId,
      type: payload.type,
      mediaUrl: mediaPayload.mediaUrl.substring(0, 50) + '...'
    });

    // Determine media type
    const mediaType = getMimeTypeFromUrl(mediaPayload.mediaUrl);
    if (!mediaType) {
      logger.warn('Could not determine media type from URL, will attempt upload with default type', {
        intentId: intent.intentId,
        mediaUrl: mediaPayload.mediaUrl.substring(0, 50) + '...'
      });
    }

    // Upload media
    const uploadResult = await uploadMediaFromUrl(
      mediaPayload.mediaUrl,
      mediaType || 'application/octet-stream',
      uploadConfig
    );

    // Create new intent with mediaId populated
    const updatedIntent: OutboundMessageIntent = {
      ...intent,
      payload: {
        ...payload,
        mediaId: uploadResult.mediaId,
        mediaUrl: undefined // Clear mediaUrl after upload
      } as OutboundMessagePayload
    };

    logger.info('Media auto-upload successful', {
      intentId: intent.intentId,
      type: payload.type,
      mediaId: uploadResult.mediaId
    });

    return updatedIntent;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error('Media auto-upload failed', {
      intentId: intent.intentId,
      type: payload.type,
      error: errorMessage
    });

    // Re-throw to prevent sending message without media
    throw new Error(`Failed to auto-upload media for ${payload.type}: ${errorMessage}`);
  }
}

/**
 * Pre-process multiple intents (batch)
 * @param intents - Array of outbound intents
 * @param uploadConfig - Configuration for media upload
 * @returns Array of pre-processed intents
 */
export async function preprocessOutboundIntentsBatch(
  intents: OutboundMessageIntent[],
  uploadConfig?: WhatsAppMediaUploadConfig
): Promise<OutboundMessageIntent[]> {
  return Promise.all(intents.map((intent) => preprocessOutboundIntent(intent, uploadConfig)));
}

import { createGraphClient, type GraphClient } from '@connectors/core-meta-graph';
import { createLogger } from '@connectors/core-logging';

const logger = createLogger({ component: 'uploadMedia' });

/**
 * WhatsApp Media Upload Configuration
 */
export interface WhatsAppMediaUploadConfig {
  accessToken: string;
  phoneNumberId: string;
  apiVersion?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

/**
 * WhatsApp Media Upload Response
 */
export interface WhatsAppMediaUploadResponse {
  mediaId: string;
  url?: string;
}

/**
 * Upload media from URL to WhatsApp Business Account
 * Returns the media ID for use in outbound messages
 *
 * @param mediaUrl - Public URL of the media file to upload
 * @param mediaType - MIME type of the media (e.g., 'video/mp4', 'application/pdf', 'image/webp')
 * @param config - WhatsApp API configuration
 * @returns Media ID for use in outbound messages
 */
export async function uploadMediaFromUrl(
  mediaUrl: string,
  mediaType: string,
  config: WhatsAppMediaUploadConfig
): Promise<WhatsAppMediaUploadResponse> {
  try {
    // Validate inputs
    if (!mediaUrl) {
      throw new Error('mediaUrl is required');
    }
    if (!mediaType) {
      throw new Error('mediaType is required');
    }

    logger.info('Downloading media from URL for upload', {
      mediaUrl: mediaUrl.substring(0, 50) + '...',
      mediaType
    });

    // Download the media file with longer timeout for videos
    const downloadTimeout = mediaType.startsWith('video/') ? 60000 : 30000; // 60s for video, 30s for others
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs || downloadTimeout);
    
    const mediaResponse = await fetch(mediaUrl, {
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    if (!mediaResponse.ok) {
      throw new Error(`Failed to download media: HTTP ${mediaResponse.status}`);
    }

    const mediaBuffer = await mediaResponse.arrayBuffer();
    const mediaBlob = new Blob([mediaBuffer], { type: mediaType });

    logger.info('Media downloaded successfully', {
      size: mediaBuffer.byteLength,
      mediaType
    });

    // Upload to WhatsApp using Graph API
    return uploadMediaBlob(mediaBlob, mediaType, config);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error('Media URL upload failed', {
      error: errorMessage,
      mediaUrl: mediaUrl.substring(0, 50) + '...'
    });
    throw err;
  }
}

/**
 * Upload media blob to WhatsApp Business Account
 * @param mediaBlob - Blob/File object containing the media data
 * @param mediaType - MIME type of the media
 * @param config - WhatsApp API configuration
 * @returns Media ID for use in outbound messages
 */
export async function uploadMediaBlob(
  mediaBlob: Blob,
  mediaType: string,
  config: WhatsAppMediaUploadConfig
): Promise<WhatsAppMediaUploadResponse> {
  try {
    const client = createGraphClient({
      accessToken: config.accessToken,
      apiVersion: config.apiVersion || 'v18.0',
      baseUrl: config.baseUrl,
      defaultTimeoutMs: config.timeoutMs || 30000,
      context: {
        connector: 'whatsapp',
        capabilityId: 'media_upload',
        channel: 'whatsapp'
      }
    });

    // Create FormData for multipart upload
    // WhatsApp Business API requires: messaging_product, file (binary), type (optional)
    const formData = new FormData();
    formData.append('messaging_product', 'whatsapp');
    formData.append('file', mediaBlob, `media.${getExtensionFromMimeType(mediaType)}`);
    formData.append('type', mediaType);

    logger.info('Uploading media to Graph API', {
      size: mediaBlob.size,
      mediaType,
      phoneNumberId: config.phoneNumberId
    });

    const response = await client.post<{
      media: Array<{ id: string }>;
      id?: string;
    }>(`${config.phoneNumberId}/media`, formData as any, {
      timeoutMs: config.timeoutMs || 30000
    });

    const mediaId =
      response.data?.media?.[0]?.id ||
      (response.data as any)?.id ||
      response.data?.id;

    if (!mediaId) {
      throw new Error('No media ID returned from Graph API');
    }

    logger.info('Media uploaded successfully', {
      mediaId,
      size: mediaBlob.size,
      mediaType
    });

    return { mediaId };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error('Media blob upload failed', {
      error: errorMessage,
      size: mediaBlob.size,
      mediaType
    });
    throw err;
  }
}

/**
 * Get file extension from MIME type
 */
function getExtensionFromMimeType(mimeType: string): string {
  const extensions: Record<string, string> = {
    'video/mp4': 'mp4',
    'video/3gpp': '3gp',
    'audio/aac': 'aac',
    'audio/mp4': 'm4a',
    'audio/mpeg': 'mp3',
    'audio/ogg': 'ogg',
    'audio/opus': 'opus',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx'
  };

  return extensions[mimeType] || mimeType.split('/')[1] || 'bin';
}

/**
 * Determine media type from file extension
 */
export function getMimeTypeFromUrl(url: string): string | null {
  const path = new URL(url).pathname;
  const ext = path.split('.').pop()?.toLowerCase();

  const mimeTypes: Record<string, string> = {
    mp4: 'video/mp4',
    '3gp': 'video/3gpp',
    aac: 'audio/aac',
    m4a: 'audio/mp4',
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
    opus: 'audio/opus',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  };

  return ext ? mimeTypes[ext] : null;
}

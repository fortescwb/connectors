import { generateHmacSha256 } from '@connectors/core-signature';

/**
 * Generate the Meta X-Hub-Signature-256 header for a payload.
 * Accepts raw string or plain object; objects are stringified deterministically.
 */
export function signMetaPayload(secret: string, payload: string | Record<string, unknown>): string {
  const rawBody = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return generateHmacSha256(secret, rawBody, 'sha256=');
}

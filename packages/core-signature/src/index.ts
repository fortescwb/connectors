import { createHmac, timingSafeEqual } from 'node:crypto';

export type VerifySignatureOptions = {
  /** The secret key used to generate the HMAC */
  secret: string;
  /** The raw request body as a Buffer or string */
  rawBody: Buffer | string;
  /** The signature header value from the request */
  signatureHeader: string;
  /** Optional prefix to strip from signature header (e.g., 'sha256=') */
  signaturePrefix?: string;
};

export type SignatureVerificationResult =
  | { valid: true }
  | { valid: false; code: 'MISSING_SIGNATURE' | 'INVALID_SIGNATURE'; message: string };

/**
 * Verify HMAC-SHA256 signature for webhook payloads.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifyHmacSha256(options: VerifySignatureOptions): SignatureVerificationResult {
  const { secret, rawBody, signatureHeader, signaturePrefix = 'sha256=' } = options;

  if (!signatureHeader) {
    return {
      valid: false,
      code: 'MISSING_SIGNATURE',
      message: 'Signature header is missing'
    };
  }

  // Strip prefix if present
  const providedSignature = signatureHeader.startsWith(signaturePrefix)
    ? signatureHeader.slice(signaturePrefix.length)
    : signatureHeader;

  // Compute expected signature
  const body = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf-8') : rawBody;
  const expectedSignature = createHmac('sha256', secret).update(body).digest('hex');

  // Timing-safe comparison
  const providedBuffer = Buffer.from(providedSignature, 'hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');

  if (providedBuffer.length !== expectedBuffer.length) {
    return {
      valid: false,
      code: 'INVALID_SIGNATURE',
      message: 'Signature verification failed'
    };
  }

  const isValid = timingSafeEqual(providedBuffer, expectedBuffer);

  if (!isValid) {
    return {
      valid: false,
      code: 'INVALID_SIGNATURE',
      message: 'Signature verification failed'
    };
  }

  return { valid: true };
}

/**
 * Generate HMAC-SHA256 signature for testing purposes.
 */
export function generateHmacSha256(secret: string, body: Buffer | string, prefix = 'sha256='): string {
  const data = typeof body === 'string' ? Buffer.from(body, 'utf-8') : body;
  const signature = createHmac('sha256', secret).update(data).digest('hex');
  return `${prefix}${signature}`;
}

/**
 * Error class for signature verification failures.
 * Can be thrown to trigger 401 response in webhook processor.
 */
export class SignatureError extends Error {
  public readonly code: 'MISSING_SIGNATURE' | 'INVALID_SIGNATURE';
  public readonly status = 401;
  public readonly statusCode = 401;

  constructor(code: 'MISSING_SIGNATURE' | 'INVALID_SIGNATURE', message: string) {
    super(message);
    this.name = 'SignatureError';
    this.code = code;
  }
}

/**
 * Verify signature and throw SignatureError if invalid.
 * Useful for integration with webhook processor that catches errors with status 401.
 */
export function assertValidSignature(options: VerifySignatureOptions): void {
  const result = verifyHmacSha256(options);
  if (!result.valid) {
    throw new SignatureError(result.code, result.message);
  }
}

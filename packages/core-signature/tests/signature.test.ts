import { describe, expect, it } from 'vitest';

import {
  verifyHmacSha256,
  generateHmacSha256,
  assertValidSignature,
  SignatureError
} from '../src/index.js';

const TEST_SECRET = 'test-secret-key';
const TEST_BODY = '{"event":"test","data":{"id":123}}';

describe('verifyHmacSha256', () => {
  it('returns valid:true for correct signature', () => {
    const signature = generateHmacSha256(TEST_SECRET, TEST_BODY);
    const result = verifyHmacSha256({
      secret: TEST_SECRET,
      rawBody: TEST_BODY,
      signatureHeader: signature
    });

    expect(result).toEqual({ valid: true });
  });

  it('returns valid:true for Buffer body', () => {
    const bodyBuffer = Buffer.from(TEST_BODY, 'utf-8');
    const signature = generateHmacSha256(TEST_SECRET, bodyBuffer);
    const result = verifyHmacSha256({
      secret: TEST_SECRET,
      rawBody: bodyBuffer,
      signatureHeader: signature
    });

    expect(result).toEqual({ valid: true });
  });

  it('returns MISSING_SIGNATURE when header is empty', () => {
    const result = verifyHmacSha256({
      secret: TEST_SECRET,
      rawBody: TEST_BODY,
      signatureHeader: ''
    });

    expect(result).toEqual({
      valid: false,
      code: 'MISSING_SIGNATURE',
      message: 'Signature header is missing'
    });
  });

  it('returns INVALID_SIGNATURE for wrong signature', () => {
    const wrongSignature = 'sha256=0000000000000000000000000000000000000000000000000000000000000000';
    const result = verifyHmacSha256({
      secret: TEST_SECRET,
      rawBody: TEST_BODY,
      signatureHeader: wrongSignature
    });

    expect(result).toEqual({
      valid: false,
      code: 'INVALID_SIGNATURE',
      message: 'Signature verification failed'
    });
  });

  it('returns INVALID_SIGNATURE for wrong secret', () => {
    const signature = generateHmacSha256('wrong-secret', TEST_BODY);
    const result = verifyHmacSha256({
      secret: TEST_SECRET,
      rawBody: TEST_BODY,
      signatureHeader: signature
    });

    expect(result).toEqual({
      valid: false,
      code: 'INVALID_SIGNATURE',
      message: 'Signature verification failed'
    });
  });

  it('returns INVALID_SIGNATURE for tampered body', () => {
    const signature = generateHmacSha256(TEST_SECRET, TEST_BODY);
    const result = verifyHmacSha256({
      secret: TEST_SECRET,
      rawBody: TEST_BODY + ' tampered',
      signatureHeader: signature
    });

    expect(result).toEqual({
      valid: false,
      code: 'INVALID_SIGNATURE',
      message: 'Signature verification failed'
    });
  });

  it('handles custom signature prefix', () => {
    const customPrefix = 'v1=';
    const signature = generateHmacSha256(TEST_SECRET, TEST_BODY, customPrefix);
    const result = verifyHmacSha256({
      secret: TEST_SECRET,
      rawBody: TEST_BODY,
      signatureHeader: signature,
      signaturePrefix: customPrefix
    });

    expect(result).toEqual({ valid: true });
  });

  it('handles signature without prefix', () => {
    const signatureWithoutPrefix = generateHmacSha256(TEST_SECRET, TEST_BODY, '');
    const result = verifyHmacSha256({
      secret: TEST_SECRET,
      rawBody: TEST_BODY,
      signatureHeader: signatureWithoutPrefix,
      signaturePrefix: ''
    });

    expect(result).toEqual({ valid: true });
  });
});

describe('assertValidSignature', () => {
  it('does not throw for valid signature', () => {
    const signature = generateHmacSha256(TEST_SECRET, TEST_BODY);
    expect(() =>
      assertValidSignature({
        secret: TEST_SECRET,
        rawBody: TEST_BODY,
        signatureHeader: signature
      })
    ).not.toThrow();
  });

  it('throws SignatureError with status 401 for invalid signature', () => {
    const wrongSignature = 'sha256=invalid';
    try {
      assertValidSignature({
        secret: TEST_SECRET,
        rawBody: TEST_BODY,
        signatureHeader: wrongSignature
      });
      expect.fail('Expected SignatureError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SignatureError);
      const sigErr = err as SignatureError;
      expect(sigErr.status).toBe(401);
      expect(sigErr.statusCode).toBe(401);
      expect(sigErr.code).toBe('INVALID_SIGNATURE');
    }
  });

  it('throws SignatureError with status 401 for missing signature', () => {
    try {
      assertValidSignature({
        secret: TEST_SECRET,
        rawBody: TEST_BODY,
        signatureHeader: ''
      });
      expect.fail('Expected SignatureError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SignatureError);
      const sigErr = err as SignatureError;
      expect(sigErr.status).toBe(401);
      expect(sigErr.code).toBe('MISSING_SIGNATURE');
    }
  });
});

describe('generateHmacSha256', () => {
  it('generates consistent signatures', () => {
    const sig1 = generateHmacSha256(TEST_SECRET, TEST_BODY);
    const sig2 = generateHmacSha256(TEST_SECRET, TEST_BODY);
    expect(sig1).toBe(sig2);
  });

  it('generates different signatures for different bodies', () => {
    const sig1 = generateHmacSha256(TEST_SECRET, TEST_BODY);
    const sig2 = generateHmacSha256(TEST_SECRET, 'different body');
    expect(sig1).not.toBe(sig2);
  });

  it('generates different signatures for different secrets', () => {
    const sig1 = generateHmacSha256(TEST_SECRET, TEST_BODY);
    const sig2 = generateHmacSha256('different-secret', TEST_BODY);
    expect(sig1).not.toBe(sig2);
  });
});

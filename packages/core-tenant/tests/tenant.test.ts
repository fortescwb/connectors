import { describe, expect, it } from 'vitest';

import { assertTenantId, isTenantId } from '../src/index.js';

describe('tenant guard', () => {
  it('accepts non-empty strings', () => {
    expect(() => assertTenantId('tenant-1')).not.toThrow();
    expect(isTenantId('tenant-1')).toBe(true);
  });

  it('rejects invalid values', () => {
    expect(() => assertTenantId('')).toThrow();
    expect(isTenantId('')).toBe(false);
    expect(isTenantId(undefined)).toBe(false);
  });
});

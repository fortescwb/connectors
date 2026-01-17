export type TenantId = string & { readonly __brand: 'TenantId' };

export function assertTenantId(value: unknown): asserts value is TenantId {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('Invalid tenant id: expected a non-empty string');
  }
}

export function isTenantId(value: unknown): value is TenantId {
  try {
    assertTenantId(value);
    return true;
  } catch {
    return false;
  }
}

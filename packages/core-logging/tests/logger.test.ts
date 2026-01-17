import { describe, expect, it, vi } from 'vitest';

import type { TenantId } from '@connectors/core-tenant';

import { createLogger } from '../src/index.js';

describe('logger', () => {
  it('emits structured json', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {}); 
    const logger = createLogger({ tenantId: 'tenant-1' as TenantId });

    logger.info('hello', { correlationId: 'corr-1', eventId: 'evt-1' });

    expect(logSpy).toHaveBeenCalled();
    const callArg = logSpy.mock.calls[0]?.[0];
    const parsed = JSON.parse(callArg as string);
    expect(parsed).toMatchObject({
      level: 'info',
      message: 'hello',
      tenantId: 'tenant-1',
      correlationId: 'corr-1',
      eventId: 'evt-1'
    });

    logSpy.mockRestore();
  });
});

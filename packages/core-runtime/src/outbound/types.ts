import type { Logger } from '@connectors/core-logging';
import type { InstagramOutboundMessageIntent, OutboundMessageIntent } from '@connectors/core-messaging';

import type { DedupeStore } from '../index.js';

export interface BaseOutboundIntent {
  intentId: string;
  tenantId: string;
  provider: string;
  to: string;
  payload: unknown;
  dedupeKey: string;
  correlationId: string;
}

export type OutboundIntent = OutboundMessageIntent | InstagramOutboundMessageIntent | BaseOutboundIntent;

export type OutboundSendFn<TIntent extends OutboundIntent = OutboundIntent, TProviderResponse = unknown> = (
  intent: TIntent,
  ctx: OutboundSendContext
) => Promise<TProviderResponse>;

export interface OutboundSendContext {
  logger: Logger;
}

export type OutboundDedupeFailMode = 'open' | 'closed';

export interface OutboundRuntimeOptions {
  dedupeStore: DedupeStore;
  dedupeTtlMs?: number;
  logger?: Logger;
  dedupeFailMode?: OutboundDedupeFailMode;
  serviceName?: string;
  connectorId?: string;
  capabilityId?: string;
}

export type OutboundItemStatus = 'sent' | 'deduped' | 'failed';

export interface OutboundItemResult {
  intentId: string;
  dedupeKey: string;
  correlationId: string;
  provider: string;
  tenantId: string;
  status: OutboundItemStatus;
  errorCode?: 'dedupe_error_blocked' | 'dedupe_error_allowed' | 'send_failed';
  errorMessage?: string;
  latencyMs?: number;
  upstreamStatus?: number;
}

export interface OutboundBatchResult<TProviderResponse = unknown> {
  summary: {
    total: number;
    sent: number;
    deduped: number;
    failed: number;
  };
  results: Array<OutboundItemResult & { providerResponse?: TProviderResponse }>;
}

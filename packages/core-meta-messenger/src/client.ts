import { createGraphClient, type GraphClient, type GraphClientConfig } from '@connectors/core-meta-graph';

export interface MessengerGraphClientConfig extends Omit<GraphClientConfig, 'context'> {
  capabilityId?: string;
  correlationId?: string;
}

/**
 * Shared Graph client for Messenger connectors.
 * Uses the core-meta-graph base with Messenger-specific observability context.
 */
export function createMessengerGraphClient(config: MessengerGraphClientConfig): GraphClient {
  return createGraphClient({
    ...config,
    context: {
      connector: 'messenger',
      capabilityId: config.capabilityId ?? 'inbound_messages',
      channel: 'messenger',
      correlationId: config.correlationId
    }
  });
}

import { z } from 'zod';

/**
 * Capability status indicates whether a feature is active, planned, or disabled.
 */
export const CapabilityStatusSchema = z.enum(['active', 'planned', 'disabled']);
export type CapabilityStatus = z.infer<typeof CapabilityStatusSchema>;

/**
 * Standard capability identifiers for connectors.
 * These define what features a connector supports.
 */
export const CapabilityIdSchema = z.enum([
  // Messaging
  'inbound_messages',
  'outbound_messages',
  'message_status_updates',

  // Comments & Engagement
  'comment_ingest',
  'comment_reply',
  'reaction_ingest',

  // Ads & Leads
  'ads_leads_ingest',
  'ads_campaign_sync',

  // Sync
  'contact_sync',
  'conversation_sync',

  // Health & Admin
  'channel_health',
  'webhook_verification'
]);
export type CapabilityId = z.infer<typeof CapabilityIdSchema>;

/**
 * A capability declaration with its status.
 */
export const CapabilitySchema = z.object({
  id: CapabilityIdSchema,
  status: CapabilityStatusSchema,
  description: z.string().optional()
});
export type Capability = z.infer<typeof CapabilitySchema>;

/**
 * Connector manifest declares metadata and capabilities for a connector.
 */
export const ConnectorManifestSchema = z.object({
  /** Unique connector identifier (e.g., 'whatsapp', 'instagram') */
  id: z.string().min(1),

  /** Human-readable name */
  name: z.string().min(1),

  /** Connector version (semver) */
  version: z.string().regex(/^\d+\.\d+\.\d+$/),

  /** Platform/provider (e.g., 'meta', 'google', 'twilio') */
  platform: z.string().min(1),

  /** List of capabilities this connector provides */
  capabilities: z.array(CapabilitySchema),

  /** Webhook path pattern (e.g., '/webhook') */
  webhookPath: z.string().default('/webhook'),

  /** Health check path */
  healthPath: z.string().default('/health'),

  /** Required environment variables */
  requiredEnvVars: z.array(z.string()).default([]),

  /** Optional environment variables */
  optionalEnvVars: z.array(z.string()).default([])
});
export type ConnectorManifest = z.infer<typeof ConnectorManifestSchema>;

/**
 * Parse and validate a connector manifest.
 */
export function parseConnectorManifest(data: unknown): ConnectorManifest {
  return ConnectorManifestSchema.parse(data);
}

/**
 * Check if a connector has a specific capability with a given status.
 */
export function hasCapability(
  manifest: ConnectorManifest,
  capabilityId: CapabilityId,
  status: CapabilityStatus = 'active'
): boolean {
  return manifest.capabilities.some((c) => c.id === capabilityId && c.status === status);
}

/**
 * Get all capabilities with a specific status.
 */
export function getCapabilitiesByStatus(
  manifest: ConnectorManifest,
  status: CapabilityStatus
): Capability[] {
  return manifest.capabilities.filter((c) => c.status === status);
}

/**
 * Create a capability helper for building manifests.
 */
export function capability(
  id: CapabilityId,
  status: CapabilityStatus = 'active',
  description?: string
): Capability {
  return { id, status, description };
}

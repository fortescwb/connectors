import { z } from 'zod';

// Re-export calendar and automation contracts
export * from './calendar.js';
export * from './automation.js';

/**
 * Capability status indicates whether a feature is active, scaffold, planned, or disabled.
 */
export const CapabilityStatusSchema = z.enum(['active', 'scaffold', 'planned', 'disabled']);
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

  // Calendar
  'calendar_read_events',
  'calendar_write_events',

  // Automation / iPaaS
  'automation_trigger',
  'automation_subscribe',

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

// ─────────────────────────────────────────────────────────────────────────────
// AUTH CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Authentication type for the connector.
 */
export const AuthTypeSchema = z.enum(['none', 'api_key', 'oauth2', 'system_jwt']);
export type AuthType = z.infer<typeof AuthTypeSchema>;

/**
 * OAuth2 configuration for connectors requiring OAuth authentication.
 */
export const OAuthConfigSchema = z.object({
  /** OAuth2 authorization endpoint URL */
  authorizationUrl: z.string().url(),

  /** OAuth2 token endpoint URL */
  tokenUrl: z.string().url(),

  /** Required OAuth2 scopes */
  scopes: z.array(z.string()),

  /** OAuth2 redirect URL (optional, can be configured at runtime) */
  redirectUrl: z.string().url().optional(),

  /** OAuth2 audience parameter (used by some providers like Auth0) */
  audience: z.string().optional(),

  /** Whether to use PKCE (Proof Key for Code Exchange) */
  pkce: z.boolean().default(false)
});
export type OAuthConfig = z.infer<typeof OAuthConfigSchema>;

/**
 * Authentication configuration for a connector.
 */
export const AuthConfigSchema = z.object({
  /** Authentication type */
  type: AuthTypeSchema,

  /** OAuth2 configuration (required when type is 'oauth2') */
  oauth: OAuthConfigSchema.optional()
}).refine(
  (data) => {
    // If type is oauth2, oauth config must be provided
    if (data.type === 'oauth2' && !data.oauth) {
      return false;
    }
    return true;
  },
  { message: 'OAuth configuration is required when auth.type is "oauth2"' }
);
export type AuthConfig = z.infer<typeof AuthConfigSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// WEBHOOK CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Signature algorithm for webhook verification.
 */
export const SignatureAlgorithmSchema = z.enum(['hmac-sha256', 'none']);
export type SignatureAlgorithm = z.infer<typeof SignatureAlgorithmSchema>;

/**
 * Webhook signature verification configuration.
 */
export const WebhookSignatureConfigSchema = z.object({
  /** Whether signature verification is enabled */
  enabled: z.boolean().default(false),

  /** Signature algorithm used by the provider */
  algorithm: SignatureAlgorithmSchema.default('none'),

  /**
   * Whether raw body is required for signature verification.
   * When true, rawBodyMiddleware() must be applied before webhook routes.
   */
  requireRawBody: z.boolean().default(false)
});
export type WebhookSignatureConfig = z.infer<typeof WebhookSignatureConfigSchema>;

/**
 * Webhook configuration for a connector.
 */
export const WebhookConfigSchema = z.object({
  /** Webhook path pattern (e.g., '/webhook') */
  path: z.string().default('/webhook'),

  /** Signature verification configuration */
  signature: WebhookSignatureConfigSchema.optional()
});
export type WebhookConfig = z.infer<typeof WebhookConfigSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// CONNECTOR MANIFEST
// ─────────────────────────────────────────────────────────────────────────────

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

  /** Authentication configuration */
  auth: AuthConfigSchema.optional(),

  /** Webhook configuration */
  webhook: WebhookConfigSchema.optional(),

  /** Webhook path pattern (e.g., '/webhook') - DEPRECATED: use webhook.path */
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

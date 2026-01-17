import { capability, type ConnectorManifest } from '@connectors/core-connectors';

/**
 * Automation (iPaaS) Connector Manifest
 *
 * Scaffold for iPaaS integrations (Zapier, Make/Integromat, n8n, etc.)
 * All capabilities are currently planned - real integration is not yet implemented.
 */
export const automationManifest: ConnectorManifest = {
  id: 'automation',
  name: 'Automation Connector',
  version: '0.1.0',
  platform: 'ipaas',

  capabilities: [
    // Automation triggers and subscriptions
    capability('automation_trigger', 'planned', 'Receive automation trigger events'),
    capability('automation_subscribe', 'planned', 'Manage automation subscriptions'),

    // Health & Admin
    capability('webhook_verification', 'planned', 'Provider webhook verification'),
    capability('channel_health', 'planned', 'Monitor automation connection health')
  ],

  webhookPath: '/webhook',
  healthPath: '/health',

  // TODO: Define required env vars when implementing real iPaaS provider
  requiredEnvVars: [],

  optionalEnvVars: [
    'AUTOMATION_WEBHOOK_SECRET',
    'AUTOMATION_API_KEY'
  ]
};

export default automationManifest;

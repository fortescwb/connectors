import { capability, type ConnectorManifest } from '@connectors/core-connectors';

/**
 * Instagram Connector Manifest
 *
 * Declares capabilities and metadata for the Instagram connector.
 * This manifest is used by the platform to understand what features
 * this connector provides.
 */
export const instagramManifest: ConnectorManifest = {
  id: 'instagram',
  name: 'Instagram Business',
  version: '0.1.0',
  platform: 'meta',

  capabilities: [
    // Messaging (Instagram Direct)
    capability(
      'inbound_messages',
      'active',
      'Receive DMs via Instagram webhook (requires shared dedupe store for production)'
    ),
    capability('outbound_messages', 'planned', 'Send DMs via Graph API (not implemented)'),
    capability('message_status_updates', 'planned', 'Receive message delivery status (not implemented)'),

    // Comments & Engagement
    capability('comment_ingest', 'planned', 'Receive comments on posts/reels (not implemented)'),
    capability('comment_reply', 'planned', 'Reply to comments via Graph API (client library only, not wired)'),
    capability('reaction_ingest', 'planned', 'Receive reactions on stories (not implemented)'),

    // Ads & Leads
    capability('ads_leads_ingest', 'planned', 'Receive leads from Instagram Lead Ads (not implemented)'),

    // Health & Admin
    capability('webhook_verification', 'active', 'Meta webhook verification endpoint'),
    capability('channel_health', 'planned', 'Monitor Instagram channel health (not implemented)')
  ],

  webhookPath: '/webhook',
  healthPath: '/health',

  requiredEnvVars: ['INSTAGRAM_VERIFY_TOKEN'],

  optionalEnvVars: ['INSTAGRAM_WEBHOOK_SECRET', 'INSTAGRAM_ACCESS_TOKEN']
};

export default instagramManifest;

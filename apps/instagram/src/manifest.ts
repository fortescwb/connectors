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
    capability('inbound_messages', 'active', 'Receive DMs via Instagram webhook'),
    capability('outbound_messages', 'planned', 'Send DMs via Graph API'),
    capability('message_status_updates', 'planned', 'Receive message delivery status'),

    // Comments & Engagement
    capability('comment_ingest', 'planned', 'Receive comments on posts/reels'),
    capability('comment_reply', 'planned', 'Reply to comments via Graph API'),
    capability('reaction_ingest', 'planned', 'Receive reactions on stories'),

    // Ads & Leads
    capability('ads_leads_ingest', 'planned', 'Receive leads from Instagram Lead Ads'),

    // Health & Admin
    capability('webhook_verification', 'active', 'Meta webhook verification endpoint'),
    capability('channel_health', 'planned', 'Monitor Instagram channel health')
  ],

  webhookPath: '/webhook',
  healthPath: '/health',

  requiredEnvVars: ['INSTAGRAM_VERIFY_TOKEN'],

  optionalEnvVars: ['INSTAGRAM_WEBHOOK_SECRET', 'INSTAGRAM_ACCESS_TOKEN']
};

export default instagramManifest;

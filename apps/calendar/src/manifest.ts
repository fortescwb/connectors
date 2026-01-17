import { capability, type ConnectorManifest } from '@connectors/core-connectors';

/**
 * Calendar Connector Manifest
 *
 * Scaffold for calendar integrations (Google Calendar, Apple Calendar, etc.)
 * All capabilities are currently planned - real integration is not yet implemented.
 */
export const calendarManifest: ConnectorManifest = {
  id: 'calendar',
  name: 'Calendar Connector',
  version: '0.1.0',
  platform: 'calendar',

  capabilities: [
    // Calendar sync
    capability('calendar_read_events', 'planned', 'Read calendar events via API'),
    capability('calendar_write_events', 'planned', 'Create/update calendar events via API'),

    // Health & Admin
    capability('webhook_verification', 'planned', 'Provider webhook verification'),
    capability('channel_health', 'planned', 'Monitor calendar connection health')
  ],

  webhookPath: '/webhook',
  healthPath: '/health',

  // TODO: Define required env vars when implementing real calendar provider
  requiredEnvVars: [],

  optionalEnvVars: [
    'CALENDAR_WEBHOOK_SECRET',
    'CALENDAR_ACCESS_TOKEN'
  ]
};

export default calendarManifest;

import { describe, expect, it } from 'vitest';

import {
  capability,
  type ConnectorManifest,
  getCapabilitiesByStatus,
  hasCapability,
  parseConnectorManifest
} from '../src/index.js';

describe('core-connectors', () => {
  const validManifest: ConnectorManifest = {
    id: 'whatsapp',
    name: 'WhatsApp Business',
    version: '0.1.0',
    platform: 'meta',
    capabilities: [
      capability('inbound_messages', 'active', 'Receive messages from WhatsApp'),
      capability('outbound_messages', 'active', 'Send messages via WhatsApp'),
      capability('webhook_verification', 'active'),
      capability('ads_leads_ingest', 'planned')
    ],
    webhookPath: '/webhook',
    healthPath: '/health',
    requiredEnvVars: ['WHATSAPP_VERIFY_TOKEN'],
    optionalEnvVars: ['WHATSAPP_WEBHOOK_SECRET']
  };

  describe('parseConnectorManifest', () => {
    it('parses a valid manifest', () => {
      const result = parseConnectorManifest(validManifest);
      expect(result.id).toBe('whatsapp');
      expect(result.platform).toBe('meta');
      expect(result.capabilities).toHaveLength(4);
    });

    it('throws on invalid manifest (missing id)', () => {
      const invalid = { ...validManifest, id: '' };
      expect(() => parseConnectorManifest(invalid)).toThrow();
    });

    it('throws on invalid capability id', () => {
      const invalid = {
        ...validManifest,
        capabilities: [{ id: 'invalid_capability', status: 'active' }]
      };
      expect(() => parseConnectorManifest(invalid)).toThrow();
    });
  });

  describe('hasCapability', () => {
    it('returns true for active capability', () => {
      expect(hasCapability(validManifest, 'inbound_messages', 'active')).toBe(true);
    });

    it('returns false for capability with different status', () => {
      expect(hasCapability(validManifest, 'ads_leads_ingest', 'active')).toBe(false);
    });

    it('returns true for planned capability when checking planned', () => {
      expect(hasCapability(validManifest, 'ads_leads_ingest', 'planned')).toBe(true);
    });

    it('returns false for non-existent capability', () => {
      expect(hasCapability(validManifest, 'comment_ingest', 'active')).toBe(false);
    });
  });

  describe('getCapabilitiesByStatus', () => {
    it('returns only active capabilities', () => {
      const active = getCapabilitiesByStatus(validManifest, 'active');
      expect(active).toHaveLength(3);
      expect(active.every((c) => c.status === 'active')).toBe(true);
    });

    it('returns only planned capabilities', () => {
      const planned = getCapabilitiesByStatus(validManifest, 'planned');
      expect(planned).toHaveLength(1);
      expect(planned[0].id).toBe('ads_leads_ingest');
    });
  });

  describe('capability helper', () => {
    it('creates capability with defaults', () => {
      const cap = capability('comment_reply');
      expect(cap.id).toBe('comment_reply');
      expect(cap.status).toBe('active');
      expect(cap.description).toBeUndefined();
    });

    it('creates capability with all fields', () => {
      const cap = capability('comment_ingest', 'planned', 'Ingest comments from posts');
      expect(cap.id).toBe('comment_ingest');
      expect(cap.status).toBe('planned');
      expect(cap.description).toBe('Ingest comments from posts');
    });
  });

  describe('auth configuration', () => {
    it('parses manifest with auth.type = none', () => {
      const manifest = {
        ...validManifest,
        auth: { type: 'none' as const }
      };
      const result = parseConnectorManifest(manifest);
      expect(result.auth?.type).toBe('none');
    });

    it('parses manifest with auth.type = api_key', () => {
      const manifest = {
        ...validManifest,
        auth: { type: 'api_key' as const }
      };
      const result = parseConnectorManifest(manifest);
      expect(result.auth?.type).toBe('api_key');
    });

    it('parses manifest with auth.type = system_jwt', () => {
      const manifest = {
        ...validManifest,
        auth: { type: 'system_jwt' as const }
      };
      const result = parseConnectorManifest(manifest);
      expect(result.auth?.type).toBe('system_jwt');
    });

    it('parses manifest with full oauth2 config', () => {
      const manifest = {
        ...validManifest,
        auth: {
          type: 'oauth2' as const,
          oauth: {
            authorizationUrl: 'https://example.com/authorize',
            tokenUrl: 'https://example.com/token',
            scopes: ['read', 'write'],
            redirectUrl: 'https://app.example.com/callback',
            audience: 'https://api.example.com',
            pkce: true
          }
        }
      };
      const result = parseConnectorManifest(manifest);
      expect(result.auth?.type).toBe('oauth2');
      expect(result.auth?.oauth?.authorizationUrl).toBe('https://example.com/authorize');
      expect(result.auth?.oauth?.tokenUrl).toBe('https://example.com/token');
      expect(result.auth?.oauth?.scopes).toEqual(['read', 'write']);
      expect(result.auth?.oauth?.redirectUrl).toBe('https://app.example.com/callback');
      expect(result.auth?.oauth?.audience).toBe('https://api.example.com');
      expect(result.auth?.oauth?.pkce).toBe(true);
    });

    it('parses manifest with minimal oauth2 config', () => {
      const manifest = {
        ...validManifest,
        auth: {
          type: 'oauth2' as const,
          oauth: {
            authorizationUrl: 'https://example.com/authorize',
            tokenUrl: 'https://example.com/token',
            scopes: ['read']
          }
        }
      };
      const result = parseConnectorManifest(manifest);
      expect(result.auth?.type).toBe('oauth2');
      expect(result.auth?.oauth?.pkce).toBe(false); // default
    });

    it('throws when oauth2 type lacks oauth config', () => {
      const manifest = {
        ...validManifest,
        auth: { type: 'oauth2' as const }
      };
      expect(() => parseConnectorManifest(manifest)).toThrow(/OAuth configuration is required/i);
    });

    it('throws on invalid auth type', () => {
      const manifest = {
        ...validManifest,
        auth: { type: 'invalid_type' }
      };
      expect(() => parseConnectorManifest(manifest)).toThrow();
    });
  });

  describe('webhook signature configuration', () => {
    it('parses manifest with webhook.signature enabled', () => {
      const manifest = {
        ...validManifest,
        webhook: {
          path: '/webhook',
          signature: {
            enabled: true,
            algorithm: 'hmac-sha256' as const,
            requireRawBody: true
          }
        }
      };
      const result = parseConnectorManifest(manifest);
      expect(result.webhook?.path).toBe('/webhook');
      expect(result.webhook?.signature?.enabled).toBe(true);
      expect(result.webhook?.signature?.algorithm).toBe('hmac-sha256');
      expect(result.webhook?.signature?.requireRawBody).toBe(true);
    });

    it('parses manifest with webhook.signature disabled', () => {
      const manifest = {
        ...validManifest,
        webhook: {
          path: '/webhook',
          signature: {
            enabled: false,
            algorithm: 'none' as const,
            requireRawBody: false
          }
        }
      };
      const result = parseConnectorManifest(manifest);
      expect(result.webhook?.signature?.enabled).toBe(false);
      expect(result.webhook?.signature?.algorithm).toBe('none');
    });

    it('parses manifest with webhook path only', () => {
      const manifest = {
        ...validManifest,
        webhook: {
          path: '/custom/webhook'
        }
      };
      const result = parseConnectorManifest(manifest);
      expect(result.webhook?.path).toBe('/custom/webhook');
      expect(result.webhook?.signature).toBeUndefined();
    });

    it('throws on invalid signature algorithm', () => {
      const manifest = {
        ...validManifest,
        webhook: {
          path: '/webhook',
          signature: {
            enabled: true,
            algorithm: 'invalid-algo',
            requireRawBody: true
          }
        }
      };
      expect(() => parseConnectorManifest(manifest)).toThrow();
    });
  });

  describe('combined auth and webhook config', () => {
    it('parses manifest with both auth and webhook config', () => {
      const manifest = {
        ...validManifest,
        auth: {
          type: 'oauth2' as const,
          oauth: {
            authorizationUrl: 'https://meta.com/oauth/authorize',
            tokenUrl: 'https://meta.com/oauth/token',
            scopes: ['pages_messaging', 'instagram_basic']
          }
        },
        webhook: {
          path: '/webhook',
          signature: {
            enabled: true,
            algorithm: 'hmac-sha256' as const,
            requireRawBody: true
          }
        }
      };
      const result = parseConnectorManifest(manifest);
      expect(result.auth?.type).toBe('oauth2');
      expect(result.auth?.oauth?.scopes).toContain('pages_messaging');
      expect(result.webhook?.signature?.enabled).toBe(true);
    });
  });

  describe('calendar and automation capabilities', () => {
    it('parses manifest with calendar capabilities', () => {
      const calendarManifest: ConnectorManifest = {
        id: 'google-calendar',
        name: 'Google Calendar',
        version: '0.1.0',
        platform: 'google',
        capabilities: [
          capability('calendar_read_events', 'active', 'Read calendar events'),
          capability('calendar_write_events', 'active', 'Create and update events'),
          capability('webhook_verification', 'active')
        ],
        webhookPath: '/webhook',
        healthPath: '/health',
        requiredEnvVars: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
        optionalEnvVars: [],
        auth: {
          type: 'oauth2',
          oauth: {
            authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
            tokenUrl: 'https://oauth2.googleapis.com/token',
            scopes: ['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/calendar.events'],
            pkce: true
          }
        }
      };
      const result = parseConnectorManifest(calendarManifest);
      expect(result.id).toBe('google-calendar');
      expect(hasCapability(result, 'calendar_read_events', 'active')).toBe(true);
      expect(hasCapability(result, 'calendar_write_events', 'active')).toBe(true);
    });

    it('parses manifest with automation capabilities', () => {
      const automationManifest: ConnectorManifest = {
        id: 'zapier',
        name: 'Zapier Integration',
        version: '0.1.0',
        platform: 'zapier',
        capabilities: [
          capability('automation_trigger', 'active', 'Send events to Zapier'),
          capability('automation_subscribe', 'active', 'Manage webhook subscriptions'),
          capability('webhook_verification', 'active')
        ],
        webhookPath: '/webhook',
        healthPath: '/health',
        requiredEnvVars: ['ZAPIER_API_KEY'],
        optionalEnvVars: [],
        auth: {
          type: 'api_key'
        },
        webhook: {
          path: '/webhook',
          signature: {
            enabled: true,
            algorithm: 'hmac-sha256',
            requireRawBody: true
          }
        }
      };
      const result = parseConnectorManifest(automationManifest);
      expect(result.id).toBe('zapier');
      expect(hasCapability(result, 'automation_trigger', 'active')).toBe(true);
      expect(hasCapability(result, 'automation_subscribe', 'active')).toBe(true);
      expect(result.auth?.type).toBe('api_key');
    });

    it('parses manifest combining calendar and automation', () => {
      const hybridManifest: ConnectorManifest = {
        id: 'make',
        name: 'Make (Integromat)',
        version: '0.1.0',
        platform: 'make',
        capabilities: [
          capability('calendar_read_events', 'active'),
          capability('calendar_write_events', 'planned'),
          capability('automation_trigger', 'active'),
          capability('automation_subscribe', 'active'),
          capability('webhook_verification', 'active')
        ],
        webhookPath: '/webhook',
        healthPath: '/health',
        requiredEnvVars: ['MAKE_API_KEY'],
        optionalEnvVars: ['MAKE_WEBHOOK_SECRET']
      };
      const result = parseConnectorManifest(hybridManifest);
      expect(result.capabilities).toHaveLength(5);
      expect(hasCapability(result, 'calendar_write_events', 'planned')).toBe(true);
      expect(hasCapability(result, 'automation_trigger', 'active')).toBe(true);
    });
  });
});

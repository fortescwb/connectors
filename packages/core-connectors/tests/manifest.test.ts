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
});

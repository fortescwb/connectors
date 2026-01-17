import { describe, expect, it } from 'vitest';

import {
  buildAdLeadDedupeKey,
  extractContactFromLead,
  normalizeFieldType,
  parseAdLead,
  parseLeadFormConfig,
  type AdLead
} from '../src/index.js';

describe('core-ads', () => {
  const validLead: AdLead = {
    externalLeadId: 'lead-123',
    externalFormId: 'form-456',
    externalAdId: 'ad-789',
    externalCampaignId: 'campaign-001',
    platform: 'meta',
    fields: [
      { name: 'email', type: 'email', value: 'test@example.com' },
      { name: 'full_name', type: 'full_name', value: 'John Doe' },
      { name: 'phone_number', type: 'phone', value: '+1234567890' }
    ],
    createdAt: '2026-01-17T10:00:00.000Z',
    isOrganic: false
  };

  describe('parseAdLead', () => {
    it('parses valid lead', () => {
      const result = parseAdLead(validLead);
      expect(result.externalLeadId).toBe('lead-123');
      expect(result.platform).toBe('meta');
      expect(result.fields).toHaveLength(3);
    });

    it('throws on missing required fields', () => {
      const invalid = { ...validLead, externalLeadId: '' };
      expect(() => parseAdLead(invalid)).toThrow();
    });

    it('applies defaults', () => {
      const minimal = {
        externalLeadId: 'lead-1',
        externalFormId: 'form-1',
        platform: 'google',
        fields: [],
        createdAt: '2026-01-17T10:00:00.000Z'
      };
      const result = parseAdLead(minimal);
      expect(result.isOrganic).toBe(false);
    });
  });

  describe('parseLeadFormConfig', () => {
    it('parses valid form config', () => {
      const config = {
        externalFormId: 'form-123',
        name: 'Newsletter Signup',
        status: 'active',
        pageId: 'page-456'
      };
      const result = parseLeadFormConfig(config);
      expect(result.externalFormId).toBe('form-123');
      expect(result.status).toBe('active');
      expect(result.fieldMappings).toEqual([]);
    });

    it('throws on invalid status', () => {
      const invalid = {
        externalFormId: 'form-123',
        name: 'Test',
        status: 'invalid'
      };
      expect(() => parseLeadFormConfig(invalid)).toThrow();
    });
  });

  describe('buildAdLeadDedupeKey', () => {
    it('builds consistent dedupe key', () => {
      const key = buildAdLeadDedupeKey('Meta', 'lead-123');
      expect(key).toBe('meta:lead:lead-123');
    });

    it('lowercases platform', () => {
      const key = buildAdLeadDedupeKey('GOOGLE', 'lead-456');
      expect(key).toBe('google:lead:lead-456');
    });
  });

  describe('extractContactFromLead', () => {
    it('extracts all contact fields', () => {
      const contact = extractContactFromLead(validLead);
      expect(contact.email).toBe('test@example.com');
      expect(contact.fullName).toBe('John Doe');
      expect(contact.phone).toBe('+1234567890');
    });

    it('returns undefined for missing fields', () => {
      const leadWithoutPhone: AdLead = {
        ...validLead,
        fields: [{ name: 'email', type: 'email', value: 'test@example.com' }]
      };
      const contact = extractContactFromLead(leadWithoutPhone);
      expect(contact.email).toBe('test@example.com');
      expect(contact.phone).toBeUndefined();
      expect(contact.fullName).toBeUndefined();
    });

    it('falls back to work_email if email not found', () => {
      const leadWithWorkEmail: AdLead = {
        ...validLead,
        fields: [{ name: 'work_email', type: 'work_email', value: 'work@example.com' }]
      };
      const contact = extractContactFromLead(leadWithWorkEmail);
      expect(contact.email).toBe('work@example.com');
    });
  });

  describe('normalizeFieldType', () => {
    it('normalizes common field names', () => {
      expect(normalizeFieldType('Email')).toBe('email');
      expect(normalizeFieldType('email_address')).toBe('email');
      expect(normalizeFieldType('Phone Number')).toBe('phone');
      expect(normalizeFieldType('full_name')).toBe('full_name');
      expect(normalizeFieldType('FirstName')).toBe('first_name');
      expect(normalizeFieldType('zip_code')).toBe('zip_code');
      expect(normalizeFieldType('postal code')).toBe('zip_code');
    });

    it('returns undefined for unknown fields', () => {
      expect(normalizeFieldType('custom_field_xyz')).toBeUndefined();
      expect(normalizeFieldType('preferences')).toBeUndefined();
    });
  });
});

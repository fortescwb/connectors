import { describe, expect, it } from 'vitest';

import {
  buildAdLeadDedupeKey,
  buildAdLeadFromMetaRaw,
  dedupeKeyLead,
  dedupeKeyLeadFromRaw,
  extractContactFromLead,
  extractContactFromMetaRaw,
  isValidMetaLeadRaw,
  normalizeFieldType,
  parseAdLead,
  parseLeadFormConfig,
  type AdLead,
  type MetaLeadRawData
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

  describe('Meta Lead normalization', () => {
    const validMetaRaw: MetaLeadRawData = {
      leadgen_id: 'meta-lead-12345',
      form_id: 'meta-form-67890',
      ad_id: 'meta-ad-111',
      adgroup_id: 'meta-campaign-222',
      page_id: 'meta-page-333',
      created_time: '2026-01-17T12:00:00Z',
      field_data: [
        { name: 'email', values: ['user@example.com'] },
        { name: 'full_name', values: ['Jane Doe'] },
        { name: 'phone_number', values: ['+5511999999999'] }
      ],
      is_organic: false
    };

    describe('buildAdLeadFromMetaRaw', () => {
      it('converts Meta raw data to AdLead', () => {
        const lead = buildAdLeadFromMetaRaw(validMetaRaw);
        expect(lead.externalLeadId).toBe('meta-lead-12345');
        expect(lead.externalFormId).toBe('meta-form-67890');
        expect(lead.externalAdId).toBe('meta-ad-111');
        expect(lead.externalCampaignId).toBe('meta-campaign-222');
        expect(lead.platform).toBe('meta');
        expect(lead.fields).toHaveLength(3);
        expect(lead.createdAt).toBe('2026-01-17T12:00:00Z');
        expect(lead.isOrganic).toBe(false);
      });

      it('normalizes field types from Meta field names', () => {
        const lead = buildAdLeadFromMetaRaw(validMetaRaw);
        const emailField = lead.fields.find((f) => f.name === 'email');
        expect(emailField?.type).toBe('email');
        expect(emailField?.value).toBe('user@example.com');
      });

      it('handles missing field_data', () => {
        const rawWithoutFields: MetaLeadRawData = {
          ...validMetaRaw,
          field_data: undefined
        };
        const lead = buildAdLeadFromMetaRaw(rawWithoutFields);
        expect(lead.fields).toEqual([]);
      });

      it('handles organic leads', () => {
        const organicRaw: MetaLeadRawData = {
          ...validMetaRaw,
          is_organic: true
        };
        const lead = buildAdLeadFromMetaRaw(organicRaw);
        expect(lead.isOrganic).toBe(true);
      });

      it('preserves raw data when provided', () => {
        const rawWithDebug: MetaLeadRawData = {
          ...validMetaRaw,
          _raw: { original: 'payload' }
        };
        const lead = buildAdLeadFromMetaRaw(rawWithDebug);
        expect(lead.meta).toEqual({ raw: { original: 'payload' } });
      });
    });

    describe('dedupeKeyLead', () => {
      it('builds stable dedupe key from AdLead', () => {
        const lead = buildAdLeadFromMetaRaw(validMetaRaw);
        const key = dedupeKeyLead(lead);
        expect(key).toBe('meta:lead:meta-lead-12345');
      });

      it('is deterministic for same input', () => {
        const lead = buildAdLeadFromMetaRaw(validMetaRaw);
        const key1 = dedupeKeyLead(lead);
        const key2 = dedupeKeyLead(lead);
        expect(key1).toBe(key2);
      });
    });

    describe('dedupeKeyLeadFromRaw', () => {
      it('builds stable dedupe key from raw data', () => {
        const key = dedupeKeyLeadFromRaw(validMetaRaw);
        expect(key).toBe('meta:lead:meta-lead-12345');
      });

      it('matches dedupeKeyLead output', () => {
        const lead = buildAdLeadFromMetaRaw(validMetaRaw);
        expect(dedupeKeyLeadFromRaw(validMetaRaw)).toBe(dedupeKeyLead(lead));
      });
    });

    describe('extractContactFromMetaRaw', () => {
      it('extracts contact info from raw data', () => {
        const contact = extractContactFromMetaRaw(validMetaRaw);
        expect(contact.email).toBe('user@example.com');
        expect(contact.fullName).toBe('Jane Doe');
        expect(contact.phone).toBe('+5511999999999');
      });
    });

    describe('isValidMetaLeadRaw', () => {
      it('returns true for valid raw data', () => {
        expect(isValidMetaLeadRaw(validMetaRaw)).toBe(true);
      });

      it('returns false for missing leadgen_id', () => {
        const invalid = { ...validMetaRaw, leadgen_id: '' };
        expect(isValidMetaLeadRaw(invalid)).toBe(false);
      });

      it('returns false for missing form_id', () => {
        const invalid = { ...validMetaRaw, form_id: '' };
        expect(isValidMetaLeadRaw(invalid)).toBe(false);
      });

      it('returns false for null/undefined', () => {
        expect(isValidMetaLeadRaw(null)).toBe(false);
        expect(isValidMetaLeadRaw(undefined)).toBe(false);
      });

      it('returns false for non-object', () => {
        expect(isValidMetaLeadRaw('string')).toBe(false);
        expect(isValidMetaLeadRaw(123)).toBe(false);
      });
    });
  });
});

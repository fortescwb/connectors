import { z } from 'zod';

import type { TenantId } from '@connectors/core-tenant';

/**
 * Lead form field types supported by Meta/Google.
 */
export const LeadFormFieldTypeSchema = z.enum([
  'email',
  'phone',
  'full_name',
  'first_name',
  'last_name',
  'city',
  'state',
  'country',
  'zip_code',
  'company_name',
  'job_title',
  'work_email',
  'work_phone',
  'custom'
]);
export type LeadFormFieldType = z.infer<typeof LeadFormFieldTypeSchema>;

/**
 * A single field in a lead form submission.
 */
export const LeadFormFieldSchema = z.object({
  /** Field type/name */
  name: z.string().min(1),

  /** Normalized type (if mappable) */
  type: LeadFormFieldTypeSchema.optional(),

  /** Field value */
  value: z.string()
});
export type LeadFormField = z.infer<typeof LeadFormFieldSchema>;

/**
 * Normalized lead from an ad form submission.
 * Represents a lead captured from Meta Lead Ads, Google Lead Forms, etc.
 */
export const AdLeadSchema = z.object({
  /** External lead ID from the platform */
  externalLeadId: z.string().min(1),

  /** External form ID */
  externalFormId: z.string().min(1),

  /** External ad ID (if available) */
  externalAdId: z.string().optional(),

  /** External campaign ID (if available) */
  externalCampaignId: z.string().optional(),

  /** Platform/source (e.g., 'meta', 'google') */
  platform: z.string().min(1),

  /** Form fields with values */
  fields: z.array(LeadFormFieldSchema),

  /** Lead creation timestamp (ISO-8601) */
  createdAt: z.string().datetime(),

  /** Is this an organic lead (not from paid ad) */
  isOrganic: z.boolean().default(false),

  /** Provider-specific metadata */
  meta: z.record(z.unknown()).optional()
});
export type AdLead = z.infer<typeof AdLeadSchema>;

/**
 * Normalized lead event for ingestion.
 */
export interface AdLeadEvent {
  /** Tenant receiving the lead */
  tenantId: TenantId;

  /** Connector that captured the lead */
  connector: string;

  /** Normalized lead data */
  lead: AdLead;

  /** Dedupe key for idempotency */
  dedupeKey: string;

  /** Correlation ID for tracing */
  correlationId?: string;
}

/**
 * Lead form configuration (for sync).
 */
export const LeadFormConfigSchema = z.object({
  /** External form ID */
  externalFormId: z.string().min(1),

  /** Form name/title */
  name: z.string().min(1),

  /** Form status */
  status: z.enum(['active', 'archived', 'deleted']),

  /** Page/account ID the form belongs to */
  pageId: z.string().optional(),

  /** Field mappings */
  fieldMappings: z
    .array(
      z.object({
        externalName: z.string(),
        normalizedType: LeadFormFieldTypeSchema.optional(),
        targetField: z.string().optional()
      })
    )
    .default([]),

  /** Last sync timestamp */
  lastSyncAt: z.string().datetime().optional()
});
export type LeadFormConfig = z.infer<typeof LeadFormConfigSchema>;

/**
 * Parse and validate an ad lead.
 */
export function parseAdLead(data: unknown): AdLead {
  return AdLeadSchema.parse(data);
}

/**
 * Parse and validate a lead form config.
 */
export function parseLeadFormConfig(data: unknown): LeadFormConfig {
  return LeadFormConfigSchema.parse(data);
}

/**
 * Build dedupe key for an ad lead.
 */
export function buildAdLeadDedupeKey(platform: string, externalLeadId: string): string {
  return `${platform.toLowerCase()}:lead:${externalLeadId}`;
}

/**
 * Extract common contact fields from lead.
 */
export function extractContactFromLead(lead: AdLead): {
  email?: string;
  phone?: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
} {
  const findField = (type: LeadFormFieldType): string | undefined => {
    return lead.fields.find((f) => f.type === type)?.value;
  };

  return {
    email: findField('email') ?? findField('work_email'),
    phone: findField('phone') ?? findField('work_phone'),
    fullName: findField('full_name'),
    firstName: findField('first_name'),
    lastName: findField('last_name')
  };
}

/**
 * Normalize field name to standard type.
 */
export function normalizeFieldType(fieldName: string): LeadFormFieldType | undefined {
  // Remove all non-letter characters and convert to lowercase
  const normalized = fieldName.toLowerCase().replace(/[^a-z]/g, '');
  const mappings: Record<string, LeadFormFieldType> = {
    email: 'email',
    emailaddress: 'email',
    phone: 'phone',
    phonenumber: 'phone',
    mobile: 'phone',
    fullname: 'full_name',
    name: 'full_name',
    firstname: 'first_name',
    lastname: 'last_name',
    city: 'city',
    state: 'state',
    country: 'country',
    zipcode: 'zip_code',
    postalcode: 'zip_code',
    zip: 'zip_code',
    company: 'company_name',
    companyname: 'company_name',
    jobtitle: 'job_title',
    title: 'job_title',
    workemail: 'work_email',
    workphone: 'work_phone'
  };
  return mappings[normalized];
}

// ─────────────────────────────────────────────────────────────────────────────
// META LEAD ADS NORMALIZATION
// Helpers for converting Meta (Facebook/Instagram) Lead Ads raw data to normalized format
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Raw lead data structure from Meta Lead Ads webhook.
 * This is a subset of the actual Meta webhook payload.
 */
export interface MetaLeadRawData {
  /** Lead ID from Meta */
  leadgen_id: string;

  /** Form ID from Meta */
  form_id: string;

  /** Ad ID (optional) */
  ad_id?: string;

  /** Campaign ID (optional) */
  adgroup_id?: string;

  /** Page ID that owns the form */
  page_id?: string;

  /** Timestamp when lead was created */
  created_time: string;

  /** Form field values */
  field_data?: Array<{
    name: string;
    values: string[];
  }>;

  /** Is this an organic lead (not from paid ad) */
  is_organic?: boolean;

  /** Original raw payload for debugging */
  _raw?: Record<string, unknown>;
}

/**
 * Build an AdLead from Meta Lead Ads raw data.
 * This is a normalization helper for Meta webhook payloads.
 */
export function buildAdLeadFromMetaRaw(raw: MetaLeadRawData): AdLead {
  const fields: LeadFormField[] = (raw.field_data ?? []).map((field) => ({
    name: field.name,
    type: normalizeFieldType(field.name),
    value: field.values[0] ?? ''
  }));

  return {
    externalLeadId: raw.leadgen_id,
    externalFormId: raw.form_id,
    externalAdId: raw.ad_id,
    externalCampaignId: raw.adgroup_id,
    platform: 'meta',
    fields,
    createdAt: raw.created_time,
    isOrganic: raw.is_organic ?? false,
    meta: raw._raw ? { raw: raw._raw } : undefined
  };
}

/**
 * Build dedupe key for a Meta Lead.
 * Uses platform + lead ID for stable deduplication.
 */
export function dedupeKeyLead(lead: AdLead): string {
  return buildAdLeadDedupeKey(lead.platform, lead.externalLeadId);
}

/**
 * Build dedupe key for a Meta Lead from raw data.
 */
export function dedupeKeyLeadFromRaw(raw: MetaLeadRawData): string {
  return buildAdLeadDedupeKey('meta', raw.leadgen_id);
}

/**
 * Extract minimal normalized contact from Meta raw lead.
 */
export function extractContactFromMetaRaw(raw: MetaLeadRawData): {
  email?: string;
  phone?: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
} {
  const lead = buildAdLeadFromMetaRaw(raw);
  return extractContactFromLead(lead);
}

/**
 * Validate that a raw Meta lead has minimum required fields.
 */
export function isValidMetaLeadRaw(raw: unknown): raw is MetaLeadRawData {
  if (!raw || typeof raw !== 'object') return false;
  const data = raw as Record<string, unknown>;
  return (
    typeof data.leadgen_id === 'string' &&
    data.leadgen_id.length > 0 &&
    typeof data.form_id === 'string' &&
    data.form_id.length > 0 &&
    typeof data.created_time === 'string'
  );
}

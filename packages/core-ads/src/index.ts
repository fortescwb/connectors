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

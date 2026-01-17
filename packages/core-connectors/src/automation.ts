import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// AUTOMATION / iPaaS CONTRACTS
// Normalized types for automation integrations (Zapier, Make, n8n, etc.)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Status of an automation subscription.
 */
export const SubscriptionStatusSchema = z.enum([
  'active',
  'paused',
  'disabled',
  'pending_verification'
]);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>;

/**
 * Standard automation event types that can be triggered.
 */
export const AutomationEventTypeSchema = z.enum([
  // Messaging
  'message.received',
  'message.sent',
  'message.status_updated',

  // Contacts
  'contact.created',
  'contact.updated',
  'contact.deleted',

  // Conversations
  'conversation.created',
  'conversation.updated',
  'conversation.closed',

  // Comments & Engagement
  'comment.received',
  'comment.replied',
  'reaction.received',

  // Leads
  'lead.captured',
  'lead.qualified',

  // Calendar
  'calendar.event_created',
  'calendar.event_updated',
  'calendar.event_deleted',
  'calendar.event_reminder',

  // Generic/Custom
  'custom'
]);
export type AutomationEventType = z.infer<typeof AutomationEventTypeSchema>;

/**
 * An automation trigger event.
 * This is the normalized payload sent to automation subscribers when an event occurs.
 */
export const AutomationTriggerEventSchema = z.object({
  /** Unique event identifier */
  id: z.string().min(1),

  /** Event type */
  type: AutomationEventTypeSchema,

  /** Custom event type name (when type is 'custom') */
  customType: z.string().optional(),

  /** When the event occurred (ISO-8601) */
  occurredAt: z.string().datetime(),

  /** Source system/connector that generated the event */
  source: z.string().min(1),

  /** Tenant/account identifier */
  tenantId: z.string().optional(),

  /** Correlation ID for tracing */
  correlationId: z.string().optional(),

  /** Event payload (type-specific data) */
  payload: z.record(z.unknown()),

  /** Metadata for routing/filtering */
  metadata: z.object({
    /** Version of the payload schema */
    schemaVersion: z.string().default('1.0'),

    /** Priority level for processing */
    priority: z.enum(['low', 'normal', 'high']).default('normal'),

    /** Tags for categorization */
    tags: z.array(z.string()).default([]),

    /** Additional key-value metadata */
    extra: z.record(z.string()).default({})
  }).default({})
});
export type AutomationTriggerEvent = z.infer<typeof AutomationTriggerEventSchema>;

/**
 * An automation subscription.
 * Defines where and how to deliver automation events.
 */
export const AutomationSubscriptionSchema = z.object({
  /** Unique subscription identifier */
  id: z.string().min(1),

  /** Human-readable name for the subscription */
  name: z.string().optional(),

  /** Event types this subscription listens to */
  eventTypes: z.array(AutomationEventTypeSchema).min(1),

  /** Target URL to deliver events to (webhook endpoint) */
  targetUrl: z.string().url(),

  /** HTTP method for delivery (default: POST) */
  httpMethod: z.enum(['POST', 'PUT']).default('POST'),

  /** Secret for signing webhook payloads (HMAC) */
  secret: z.string().optional(),

  /** Subscription status */
  status: SubscriptionStatusSchema.default('active'),

  /** Tenant/account this subscription belongs to */
  tenantId: z.string().optional(),

  /** Filter conditions (only deliver events matching these) */
  filters: z.object({
    /** Source filter (e.g., only events from 'whatsapp') */
    sources: z.array(z.string()).optional(),

    /** Tag filter (event must have at least one of these tags) */
    tags: z.array(z.string()).optional(),

    /** Custom filter expression (provider-specific) */
    expression: z.string().optional()
  }).optional(),

  /** Delivery configuration */
  delivery: z.object({
    /** Number of retry attempts on failure */
    maxRetries: z.number().int().min(0).max(10).default(3),

    /** Timeout for each delivery attempt (seconds) */
    timeoutSeconds: z.number().int().min(1).max(60).default(30),

    /** Headers to include in delivery requests */
    headers: z.record(z.string()).default({})
  }).default({}),

  /** When the subscription was created (ISO-8601) */
  createdAt: z.string().datetime().optional(),

  /** When the subscription was last updated (ISO-8601) */
  updatedAt: z.string().datetime().optional(),

  /** Verification token for endpoint validation */
  verificationToken: z.string().optional()
});
export type AutomationSubscription = z.infer<typeof AutomationSubscriptionSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// SUBSCRIPTION MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Request to create a new automation subscription.
 */
export const CreateSubscriptionRequestSchema = z.object({
  /** Human-readable name */
  name: z.string().optional(),

  /** Event types to subscribe to */
  eventTypes: z.array(AutomationEventTypeSchema).min(1),

  /** Target URL for event delivery */
  targetUrl: z.string().url(),

  /** Secret for HMAC signing (optional, generated if not provided) */
  secret: z.string().optional(),

  /** Optional filters */
  filters: AutomationSubscriptionSchema.shape.filters,

  /** Optional delivery configuration */
  delivery: AutomationSubscriptionSchema.shape.delivery
});
export type CreateSubscriptionRequest = z.infer<typeof CreateSubscriptionRequestSchema>;

/**
 * Response from creating a subscription.
 */
export const CreateSubscriptionResponseSchema = z.object({
  /** Whether creation succeeded */
  success: z.boolean(),

  /** Created subscription (if successful) */
  subscription: AutomationSubscriptionSchema.optional(),

  /** Error message (if failed) */
  error: z.string().optional(),

  /** Verification required (for endpoint validation) */
  verificationRequired: z.boolean().default(false)
});
export type CreateSubscriptionResponse = z.infer<typeof CreateSubscriptionResponseSchema>;

/**
 * Request to update an existing subscription.
 */
export const UpdateSubscriptionRequestSchema = z.object({
  /** Subscription ID to update */
  id: z.string().min(1),

  /** New name (optional) */
  name: z.string().optional(),

  /** New event types (optional) */
  eventTypes: z.array(AutomationEventTypeSchema).optional(),

  /** New target URL (optional) */
  targetUrl: z.string().url().optional(),

  /** New status (optional) */
  status: SubscriptionStatusSchema.optional(),

  /** New filters (optional) */
  filters: AutomationSubscriptionSchema.shape.filters,

  /** New delivery configuration (optional) */
  delivery: AutomationSubscriptionSchema.shape.delivery
});
export type UpdateSubscriptionRequest = z.infer<typeof UpdateSubscriptionRequestSchema>;

/**
 * Response from updating a subscription.
 */
export const UpdateSubscriptionResponseSchema = z.object({
  /** Whether update succeeded */
  success: z.boolean(),

  /** Updated subscription (if successful) */
  subscription: AutomationSubscriptionSchema.optional(),

  /** Error message (if failed) */
  error: z.string().optional()
});
export type UpdateSubscriptionResponse = z.infer<typeof UpdateSubscriptionResponseSchema>;

/**
 * Request to delete a subscription.
 */
export const DeleteSubscriptionRequestSchema = z.object({
  /** Subscription ID to delete */
  id: z.string().min(1)
});
export type DeleteSubscriptionRequest = z.infer<typeof DeleteSubscriptionRequestSchema>;

/**
 * Response from deleting a subscription.
 */
export const DeleteSubscriptionResponseSchema = z.object({
  /** Whether deletion succeeded */
  success: z.boolean(),

  /** Error message (if failed) */
  error: z.string().optional()
});
export type DeleteSubscriptionResponse = z.infer<typeof DeleteSubscriptionResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// DELIVERY TRACKING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Status of an event delivery attempt.
 */
export const DeliveryStatusSchema = z.enum([
  'pending',
  'delivered',
  'failed',
  'retrying'
]);
export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>;

/**
 * Record of an event delivery attempt.
 */
export const DeliveryAttemptSchema = z.object({
  /** Delivery attempt ID */
  id: z.string().min(1),

  /** Subscription that received this delivery */
  subscriptionId: z.string().min(1),

  /** Event that was delivered */
  eventId: z.string().min(1),

  /** Delivery status */
  status: DeliveryStatusSchema,

  /** HTTP status code from target (if available) */
  httpStatus: z.number().int().optional(),

  /** Response body from target (truncated if large) */
  responseBody: z.string().optional(),

  /** Error message (if failed) */
  error: z.string().optional(),

  /** Attempt number (1 = first attempt) */
  attemptNumber: z.number().int().min(1),

  /** When delivery was attempted (ISO-8601) */
  attemptedAt: z.string().datetime(),

  /** Duration of the request (milliseconds) */
  durationMs: z.number().int().nonnegative().optional()
});
export type DeliveryAttempt = z.infer<typeof DeliveryAttemptSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse and validate an automation trigger event.
 */
export function parseAutomationTriggerEvent(data: unknown): AutomationTriggerEvent {
  return AutomationTriggerEventSchema.parse(data);
}

/**
 * Parse and validate an automation subscription.
 */
export function parseAutomationSubscription(data: unknown): AutomationSubscription {
  return AutomationSubscriptionSchema.parse(data);
}

/**
 * Build a dedupe key for an automation trigger event.
 * Format: automation:{source}:{eventId}
 */
export function buildAutomationEventDedupeKey(source: string, eventId: string): string {
  return `automation:${source.toLowerCase()}:${eventId}`;
}

/**
 * Create an automation trigger event with defaults.
 */
export function createAutomationTriggerEvent(
  params: Pick<AutomationTriggerEvent, 'id' | 'type' | 'source' | 'payload'> &
    Partial<Omit<AutomationTriggerEvent, 'id' | 'type' | 'source' | 'payload'>>
): AutomationTriggerEvent {
  return {
    occurredAt: new Date().toISOString(),
    metadata: {
      schemaVersion: '1.0',
      priority: 'normal',
      tags: [],
      extra: {}
    },
    ...params
  };
}

/**
 * Check if a subscription is active and should receive events.
 */
export function isSubscriptionActive(subscription: AutomationSubscription): boolean {
  return subscription.status === 'active';
}

/**
 * Check if a subscription matches an event (based on filters).
 */
export function subscriptionMatchesEvent(
  subscription: AutomationSubscription,
  event: AutomationTriggerEvent
): boolean {
  // Check event type
  if (!subscription.eventTypes.includes(event.type)) {
    return false;
  }

  // Check source filter
  if (subscription.filters?.sources?.length) {
    if (!subscription.filters.sources.includes(event.source)) {
      return false;
    }
  }

  // Check tag filter (event must have at least one matching tag)
  if (subscription.filters?.tags?.length) {
    const eventTags = event.metadata?.tags ?? [];
    const hasMatchingTag = subscription.filters.tags.some((tag) => eventTags.includes(tag));
    if (!hasMatchingTag) {
      return false;
    }
  }

  return true;
}

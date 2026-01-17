import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// CALENDAR CONTRACTS
// Normalized types for calendar integrations (Google Calendar, Apple Calendar, etc.)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attendee status in a calendar event.
 */
export const AttendeeStatusSchema = z.enum([
  'pending',
  'accepted',
  'declined',
  'tentative'
]);
export type AttendeeStatus = z.infer<typeof AttendeeStatusSchema>;

/**
 * A calendar event attendee.
 */
export const CalendarAttendeeSchema = z.object({
  /** Attendee email address */
  email: z.string().email(),

  /** Attendee display name */
  name: z.string().optional(),

  /** Attendance status */
  status: AttendeeStatusSchema.default('pending'),

  /** Whether this attendee is the organizer */
  isOrganizer: z.boolean().default(false),

  /** Whether this attendee is optional */
  isOptional: z.boolean().default(false)
});
export type CalendarAttendee = z.infer<typeof CalendarAttendeeSchema>;

/**
 * Calendar event recurrence rule (simplified iCal RRULE).
 */
export const RecurrenceRuleSchema = z.object({
  /** Frequency of recurrence */
  frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),

  /** Interval between occurrences (e.g., 2 = every 2 weeks) */
  interval: z.number().int().positive().default(1),

  /** Days of the week for weekly recurrence (0=Sunday, 6=Saturday) */
  byWeekday: z.array(z.number().int().min(0).max(6)).optional(),

  /** Day of the month for monthly recurrence */
  byMonthDay: z.number().int().min(1).max(31).optional(),

  /** End date for recurrence (ISO-8601) */
  until: z.string().datetime().optional(),

  /** Maximum number of occurrences */
  count: z.number().int().positive().optional()
});
export type RecurrenceRule = z.infer<typeof RecurrenceRuleSchema>;

/**
 * Normalized calendar event.
 * Represents a single event in a calendar, compatible with Google/Apple/Outlook.
 */
export const CalendarEventSchema = z.object({
  /** Unique event identifier (provider-specific) */
  id: z.string().min(1),

  /** Calendar/account identifier this event belongs to */
  calendarId: z.string().min(1),

  /** Event title/summary */
  title: z.string(),

  /** Event description/body (optional) */
  description: z.string().optional(),

  /** Start time (ISO-8601 datetime) */
  start: z.string().datetime(),

  /** End time (ISO-8601 datetime) */
  end: z.string().datetime(),

  /** Timezone (IANA timezone, e.g., 'America/Sao_Paulo') */
  timezone: z.string().default('UTC'),

  /** Whether this is an all-day event */
  isAllDay: z.boolean().default(false),

  /** Physical or virtual location */
  location: z.string().optional(),

  /** Video conferencing URL (Meet, Zoom, etc.) */
  conferenceUrl: z.string().url().optional(),

  /** Event attendees */
  attendees: z.array(CalendarAttendeeSchema).default([]),

  /** Recurrence rule for recurring events */
  recurrence: RecurrenceRuleSchema.optional(),

  /** ID of the recurring event this instance belongs to */
  recurringEventId: z.string().optional(),

  /** Event status */
  status: z.enum(['confirmed', 'tentative', 'cancelled']).default('confirmed'),

  /** When the event was created (ISO-8601) */
  createdAt: z.string().datetime().optional(),

  /** When the event was last updated (ISO-8601) */
  updatedAt: z.string().datetime().optional(),

  /** Original provider-specific data (for debugging/extension) */
  raw: z.record(z.unknown()).optional()
});
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// READ EVENTS (Sync/Pull)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Request to read calendar events.
 * Supports time-range filtering and cursor-based pagination.
 */
export const CalendarReadEventsRequestSchema = z.object({
  /** Calendar identifier to read from */
  calendarId: z.string().min(1),

  /** Start of time range (ISO-8601) - inclusive */
  timeMin: z.string().datetime().optional(),

  /** End of time range (ISO-8601) - exclusive */
  timeMax: z.string().datetime().optional(),

  /** Cursor for incremental sync (from previous response) */
  syncCursor: z.string().optional(),

  /** Maximum number of events to return */
  maxResults: z.number().int().positive().max(2500).default(250),

  /** Whether to include deleted events (for sync) */
  showDeleted: z.boolean().default(false),

  /** Whether to expand recurring events into instances */
  expandRecurring: z.boolean().default(true)
});
export type CalendarReadEventsRequest = z.infer<typeof CalendarReadEventsRequestSchema>;

/**
 * Response from reading calendar events.
 */
export const CalendarReadEventsResponseSchema = z.object({
  /** List of calendar events */
  events: z.array(CalendarEventSchema),

  /** Cursor for fetching next page (null if no more pages) */
  nextPageCursor: z.string().nullable(),

  /** Cursor for incremental sync (use in next sync request) */
  nextSyncCursor: z.string().optional(),

  /** Whether this is a full sync (vs incremental) */
  isFullSync: z.boolean().default(true),

  /** Total count of events (if available from provider) */
  totalCount: z.number().int().nonnegative().optional()
});
export type CalendarReadEventsResponse = z.infer<typeof CalendarReadEventsResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// WRITE EVENT (Create/Update)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Request to create or update a calendar event.
 */
export const CalendarWriteEventRequestSchema = z.object({
  /** Calendar identifier to write to */
  calendarId: z.string().min(1),

  /** Event ID (for updates; omit for create) */
  eventId: z.string().optional(),

  /** Event data */
  event: CalendarEventSchema.omit({ id: true, calendarId: true, createdAt: true, updatedAt: true, raw: true }).extend({
    /** For updates, optionally override ID in event body */
    id: z.string().optional()
  }),

  /** Whether to send notifications to attendees */
  sendNotifications: z.boolean().default(true),

  /** Conference solution to create (e.g., 'hangoutsMeet') */
  createConference: z.string().optional()
});
export type CalendarWriteEventRequest = z.infer<typeof CalendarWriteEventRequestSchema>;

/**
 * Response from writing a calendar event.
 */
export const CalendarWriteEventResponseSchema = z.object({
  /** Whether the operation succeeded */
  success: z.boolean(),

  /** Created/updated event */
  event: CalendarEventSchema.optional(),

  /** Error message if operation failed */
  error: z.string().optional(),

  /** Provider-specific error code */
  errorCode: z.string().optional()
});
export type CalendarWriteEventResponse = z.infer<typeof CalendarWriteEventResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// DELETE EVENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Request to delete a calendar event.
 */
export const CalendarDeleteEventRequestSchema = z.object({
  /** Calendar identifier */
  calendarId: z.string().min(1),

  /** Event ID to delete */
  eventId: z.string().min(1),

  /** Whether to send cancellation notifications */
  sendNotifications: z.boolean().default(true)
});
export type CalendarDeleteEventRequest = z.infer<typeof CalendarDeleteEventRequestSchema>;

/**
 * Response from deleting a calendar event.
 */
export const CalendarDeleteEventResponseSchema = z.object({
  /** Whether the operation succeeded */
  success: z.boolean(),

  /** Error message if operation failed */
  error: z.string().optional(),

  /** Provider-specific error code */
  errorCode: z.string().optional()
});
export type CalendarDeleteEventResponse = z.infer<typeof CalendarDeleteEventResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse and validate a calendar event.
 */
export function parseCalendarEvent(data: unknown): CalendarEvent {
  return CalendarEventSchema.parse(data);
}

/**
 * Parse and validate a read events request.
 */
export function parseCalendarReadEventsRequest(data: unknown): CalendarReadEventsRequest {
  return CalendarReadEventsRequestSchema.parse(data);
}

/**
 * Parse and validate a write event request.
 */
export function parseCalendarWriteEventRequest(data: unknown): CalendarWriteEventRequest {
  return CalendarWriteEventRequestSchema.parse(data);
}

/**
 * Build a dedupe key for a calendar event.
 * Format: calendar:{calendarId}:{eventId}
 */
export function buildCalendarEventDedupeKey(calendarId: string, eventId: string): string {
  return `calendar:${calendarId.toLowerCase()}:${eventId}`;
}

/**
 * Check if two time ranges overlap.
 * Useful for filtering events in time-range queries.
 */
export function timeRangesOverlap(
  start1: string | Date,
  end1: string | Date,
  start2: string | Date,
  end2: string | Date
): boolean {
  const s1 = new Date(start1).getTime();
  const e1 = new Date(end1).getTime();
  const s2 = new Date(start2).getTime();
  const e2 = new Date(end2).getTime();

  return s1 < e2 && e1 > s2;
}

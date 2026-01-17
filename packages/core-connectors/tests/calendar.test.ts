import { describe, expect, it } from 'vitest';

import {
  buildCalendarEventDedupeKey,
  CalendarEventSchema,
  CalendarReadEventsRequestSchema,
  CalendarReadEventsResponseSchema,
  CalendarWriteEventRequestSchema,
  CalendarWriteEventResponseSchema,
  CalendarDeleteEventRequestSchema,
  CalendarDeleteEventResponseSchema,
  parseCalendarEvent,
  parseCalendarReadEventsRequest,
  parseCalendarWriteEventRequest,
  timeRangesOverlap,
  type CalendarEvent,
  type CalendarAttendee,
  type RecurrenceRule
} from '../src/index.js';

describe('calendar contracts', () => {
  const validCalendarEvent: CalendarEvent = {
    id: 'event-123',
    calendarId: 'primary',
    title: 'Team Meeting',
    description: 'Weekly sync',
    start: '2026-01-20T10:00:00Z',
    end: '2026-01-20T11:00:00Z',
    timezone: 'America/Sao_Paulo',
    isAllDay: false,
    location: 'Conference Room A',
    conferenceUrl: 'https://meet.google.com/abc-defg-hij',
    attendees: [
      {
        email: 'organizer@example.com',
        name: 'Organizer',
        status: 'accepted',
        isOrganizer: true,
        isOptional: false
      },
      {
        email: 'attendee@example.com',
        name: 'Attendee',
        status: 'pending',
        isOrganizer: false,
        isOptional: false
      }
    ],
    status: 'confirmed',
    createdAt: '2026-01-15T08:00:00Z',
    updatedAt: '2026-01-15T08:00:00Z'
  };

  describe('CalendarEventSchema', () => {
    it('parses a valid calendar event', () => {
      const result = CalendarEventSchema.parse(validCalendarEvent);
      expect(result.id).toBe('event-123');
      expect(result.title).toBe('Team Meeting');
      expect(result.attendees).toHaveLength(2);
    });

    it('parses minimal calendar event with defaults', () => {
      const minimal = {
        id: 'event-456',
        calendarId: 'primary',
        title: 'Quick Call',
        start: '2026-01-20T14:00:00Z',
        end: '2026-01-20T14:30:00Z'
      };
      const result = CalendarEventSchema.parse(minimal);
      expect(result.timezone).toBe('UTC');
      expect(result.isAllDay).toBe(false);
      expect(result.attendees).toEqual([]);
      expect(result.status).toBe('confirmed');
    });

    it('parses all-day event', () => {
      const allDayEvent = {
        ...validCalendarEvent,
        isAllDay: true,
        start: '2026-01-20T00:00:00Z',
        end: '2026-01-21T00:00:00Z'
      };
      const result = CalendarEventSchema.parse(allDayEvent);
      expect(result.isAllDay).toBe(true);
    });

    it('parses recurring event', () => {
      const recurringEvent = {
        ...validCalendarEvent,
        recurrence: {
          frequency: 'weekly',
          interval: 1,
          byWeekday: [1, 3, 5], // Mon, Wed, Fri
          count: 10
        }
      };
      const result = CalendarEventSchema.parse(recurringEvent);
      expect(result.recurrence?.frequency).toBe('weekly');
      expect(result.recurrence?.byWeekday).toEqual([1, 3, 5]);
    });

    it('throws on invalid start date', () => {
      const invalid = { ...validCalendarEvent, start: 'not-a-date' };
      expect(() => CalendarEventSchema.parse(invalid)).toThrow();
    });

    it('throws on invalid attendee email', () => {
      const invalid = {
        ...validCalendarEvent,
        attendees: [{ email: 'not-an-email', status: 'pending' }]
      };
      expect(() => CalendarEventSchema.parse(invalid)).toThrow();
    });

    it('accepts event with raw provider data', () => {
      const withRaw = {
        ...validCalendarEvent,
        raw: { googleEventId: 'abc123', etag: '"xyz"' }
      };
      const result = CalendarEventSchema.parse(withRaw);
      expect(result.raw).toEqual({ googleEventId: 'abc123', etag: '"xyz"' });
    });
  });

  describe('attendee schema', () => {
    it('accepts all attendee statuses', () => {
      const statuses = ['pending', 'accepted', 'declined', 'tentative'] as const;
      for (const status of statuses) {
        const attendee: CalendarAttendee = {
          email: 'test@example.com',
          status
        };
        const result = CalendarEventSchema.parse({
          ...validCalendarEvent,
          attendees: [attendee]
        });
        expect(result.attendees[0].status).toBe(status);
      }
    });
  });

  describe('recurrence schema', () => {
    it('accepts all recurrence frequencies', () => {
      const frequencies = ['daily', 'weekly', 'monthly', 'yearly'] as const;
      for (const frequency of frequencies) {
        const recurrence: RecurrenceRule = { frequency };
        const result = CalendarEventSchema.parse({
          ...validCalendarEvent,
          recurrence
        });
        expect(result.recurrence?.frequency).toBe(frequency);
      }
    });

    it('accepts recurrence with until date', () => {
      const recurrence: RecurrenceRule = {
        frequency: 'daily',
        until: '2026-12-31T23:59:59Z'
      };
      const result = CalendarEventSchema.parse({
        ...validCalendarEvent,
        recurrence
      });
      expect(result.recurrence?.until).toBe('2026-12-31T23:59:59Z');
    });
  });

  describe('CalendarReadEventsRequestSchema', () => {
    it('parses valid read request', () => {
      const request = {
        calendarId: 'primary',
        timeMin: '2026-01-01T00:00:00Z',
        timeMax: '2026-01-31T23:59:59Z',
        maxResults: 100
      };
      const result = CalendarReadEventsRequestSchema.parse(request);
      expect(result.calendarId).toBe('primary');
      expect(result.maxResults).toBe(100);
    });

    it('applies defaults', () => {
      const minimal = { calendarId: 'primary' };
      const result = CalendarReadEventsRequestSchema.parse(minimal);
      expect(result.maxResults).toBe(250);
      expect(result.showDeleted).toBe(false);
      expect(result.expandRecurring).toBe(true);
    });

    it('accepts sync cursor for incremental sync', () => {
      const request = {
        calendarId: 'primary',
        syncCursor: 'CAIScQoKdG9kby1jYXJkLTEaK...'
      };
      const result = CalendarReadEventsRequestSchema.parse(request);
      expect(result.syncCursor).toBe('CAIScQoKdG9kby1jYXJkLTEaK...');
    });

    it('throws on maxResults > 2500', () => {
      const invalid = { calendarId: 'primary', maxResults: 3000 };
      expect(() => CalendarReadEventsRequestSchema.parse(invalid)).toThrow();
    });
  });

  describe('CalendarReadEventsResponseSchema', () => {
    it('parses valid response with events', () => {
      const response = {
        events: [validCalendarEvent],
        nextPageCursor: 'page-2-cursor',
        nextSyncCursor: 'sync-cursor-xyz',
        isFullSync: true,
        totalCount: 42
      };
      const result = CalendarReadEventsResponseSchema.parse(response);
      expect(result.events).toHaveLength(1);
      expect(result.nextPageCursor).toBe('page-2-cursor');
    });

    it('accepts null nextPageCursor (no more pages)', () => {
      const response = {
        events: [],
        nextPageCursor: null
      };
      const result = CalendarReadEventsResponseSchema.parse(response);
      expect(result.nextPageCursor).toBeNull();
    });
  });

  describe('CalendarWriteEventRequestSchema', () => {
    it('parses valid create request', () => {
      const request = {
        calendarId: 'primary',
        event: {
          title: 'New Meeting',
          start: '2026-01-25T10:00:00Z',
          end: '2026-01-25T11:00:00Z',
          timezone: 'UTC'
        },
        sendNotifications: true
      };
      const result = CalendarWriteEventRequestSchema.parse(request);
      expect(result.event.title).toBe('New Meeting');
      expect(result.sendNotifications).toBe(true);
    });

    it('parses update request with eventId', () => {
      const request = {
        calendarId: 'primary',
        eventId: 'existing-event-123',
        event: {
          title: 'Updated Meeting',
          start: '2026-01-25T11:00:00Z',
          end: '2026-01-25T12:00:00Z',
          timezone: 'UTC'
        }
      };
      const result = CalendarWriteEventRequestSchema.parse(request);
      expect(result.eventId).toBe('existing-event-123');
    });

    it('accepts createConference option', () => {
      const request = {
        calendarId: 'primary',
        event: {
          title: 'Video Call',
          start: '2026-01-25T10:00:00Z',
          end: '2026-01-25T11:00:00Z',
          timezone: 'UTC'
        },
        createConference: 'hangoutsMeet'
      };
      const result = CalendarWriteEventRequestSchema.parse(request);
      expect(result.createConference).toBe('hangoutsMeet');
    });
  });

  describe('CalendarWriteEventResponseSchema', () => {
    it('parses successful response', () => {
      const response = {
        success: true,
        event: validCalendarEvent
      };
      const result = CalendarWriteEventResponseSchema.parse(response);
      expect(result.success).toBe(true);
      expect(result.event?.id).toBe('event-123');
    });

    it('parses error response', () => {
      const response = {
        success: false,
        error: 'Calendar not found',
        errorCode: 'NOT_FOUND'
      };
      const result = CalendarWriteEventResponseSchema.parse(response);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Calendar not found');
    });
  });

  describe('CalendarDeleteEventRequestSchema', () => {
    it('parses valid delete request', () => {
      const request = {
        calendarId: 'primary',
        eventId: 'event-to-delete',
        sendNotifications: false
      };
      const result = CalendarDeleteEventRequestSchema.parse(request);
      expect(result.eventId).toBe('event-to-delete');
      expect(result.sendNotifications).toBe(false);
    });
  });

  describe('CalendarDeleteEventResponseSchema', () => {
    it('parses successful delete', () => {
      const response = { success: true };
      const result = CalendarDeleteEventResponseSchema.parse(response);
      expect(result.success).toBe(true);
    });

    it('parses failed delete', () => {
      const response = {
        success: false,
        error: 'Event not found',
        errorCode: 'NOT_FOUND'
      };
      const result = CalendarDeleteEventResponseSchema.parse(response);
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('NOT_FOUND');
    });
  });

  describe('helper functions', () => {
    describe('parseCalendarEvent', () => {
      it('parses valid event', () => {
        const result = parseCalendarEvent(validCalendarEvent);
        expect(result.id).toBe('event-123');
      });

      it('throws on invalid event', () => {
        expect(() => parseCalendarEvent({ invalid: true })).toThrow();
      });
    });

    describe('parseCalendarReadEventsRequest', () => {
      it('parses valid request', () => {
        const result = parseCalendarReadEventsRequest({ calendarId: 'primary' });
        expect(result.calendarId).toBe('primary');
      });
    });

    describe('parseCalendarWriteEventRequest', () => {
      it('parses valid request', () => {
        const result = parseCalendarWriteEventRequest({
          calendarId: 'primary',
          event: {
            title: 'Test',
            start: '2026-01-25T10:00:00Z',
            end: '2026-01-25T11:00:00Z',
            timezone: 'UTC'
          }
        });
        expect(result.event.title).toBe('Test');
      });
    });

    describe('buildCalendarEventDedupeKey', () => {
      it('builds correct dedupe key', () => {
        const key = buildCalendarEventDedupeKey('PRIMARY', 'event-123');
        expect(key).toBe('calendar:primary:event-123');
      });
    });

    describe('timeRangesOverlap', () => {
      it('returns true for overlapping ranges', () => {
        expect(
          timeRangesOverlap(
            '2026-01-20T10:00:00Z',
            '2026-01-20T12:00:00Z',
            '2026-01-20T11:00:00Z',
            '2026-01-20T13:00:00Z'
          )
        ).toBe(true);
      });

      it('returns false for non-overlapping ranges', () => {
        expect(
          timeRangesOverlap(
            '2026-01-20T10:00:00Z',
            '2026-01-20T11:00:00Z',
            '2026-01-20T12:00:00Z',
            '2026-01-20T13:00:00Z'
          )
        ).toBe(false);
      });

      it('returns false for adjacent ranges (no overlap)', () => {
        expect(
          timeRangesOverlap(
            '2026-01-20T10:00:00Z',
            '2026-01-20T11:00:00Z',
            '2026-01-20T11:00:00Z',
            '2026-01-20T12:00:00Z'
          )
        ).toBe(false);
      });

      it('returns true when one range contains another', () => {
        expect(
          timeRangesOverlap(
            '2026-01-20T09:00:00Z',
            '2026-01-20T15:00:00Z',
            '2026-01-20T10:00:00Z',
            '2026-01-20T12:00:00Z'
          )
        ).toBe(true);
      });

      it('works with Date objects', () => {
        expect(
          timeRangesOverlap(
            new Date('2026-01-20T10:00:00Z'),
            new Date('2026-01-20T12:00:00Z'),
            new Date('2026-01-20T11:00:00Z'),
            new Date('2026-01-20T13:00:00Z')
          )
        ).toBe(true);
      });
    });
  });
});

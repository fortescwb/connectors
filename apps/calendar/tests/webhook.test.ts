import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import { calendarManifest } from '../src/manifest.js';

describe('calendar app', () => {
  describe('manifest', () => {
    it('has required fields', () => {
      expect(calendarManifest.id).toBe('calendar');
      expect(calendarManifest.platform).toBe('calendar');
      expect(calendarManifest.version).toBe('0.1.0');
    });

    it('declares calendar capabilities as planned', () => {
      const capabilityIds = calendarManifest.capabilities.map((c) => c.id);
      expect(capabilityIds).toContain('calendar_read_events');
      expect(capabilityIds).toContain('calendar_write_events');

      // All capabilities should be planned (scaffold)
      const allPlanned = calendarManifest.capabilities.every((c) => c.status === 'planned');
      expect(allPlanned).toBe(true);
    });
  });

  describe('health check', () => {
    it('responds 200 on /health with connector info', async () => {
      const app = buildApp();
      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ok', connector: 'calendar' });
    });
  });

  describe('webhook POST', () => {
    it('rejects webhook payload with 400 (not implemented)', async () => {
      const app = buildApp();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const response = await request(app)
        .post('/webhook')
        .send({ event: 'calendar.event_created' });

      expect(response.status).toBe(400);
      expect(response.body.ok).toBe(false);
      expect(response.body.code).toBe('WEBHOOK_VALIDATION_FAILED');
      expect(response.body.message).toContain('not yet implemented');
      expect(typeof response.body.correlationId).toBe('string');
      expect(response.headers['x-correlation-id']).toBe(response.body.correlationId);

      logSpy.mockRestore();
    });
  });

  describe('webhook GET', () => {
    it('returns 503 for verification (not implemented)', async () => {
      const app = buildApp();
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const response = await request(app).get('/webhook');

      expect(response.status).toBe(503);
      expect(response.body.ok).toBe(false);
      expect(response.body.code).toBe('SERVICE_UNAVAILABLE');
      expect(typeof response.body.correlationId).toBe('string');

      logSpy.mockRestore();
    });
  });
});

/**
 * Health Route Tests
 * Unit tests for health check endpoint
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app/app.js';

describe('Health Routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /health', () => {
    it('should return 200 with valid health data', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);

      const json = response.json() as {
        success: boolean;
        data: {
          status: string;
          time: string;
          version: string;
          uptime: number;
          environment: string;
        };
        timestamp: string;
        trace_id: string;
      };

      expect(json.success).toBe(true);
      expect(json.data).toHaveProperty('status', 'ok');
      expect(json.data).toHaveProperty('time');
      expect(json.data).toHaveProperty('version');
      expect(json.data).toHaveProperty('uptime');
      expect(json.data).toHaveProperty('environment');
      expect(json).toHaveProperty('timestamp');
      expect(json).toHaveProperty('trace_id');
    });

    it('should include trace_id in response headers', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.headers['x-trace-id']).toBeDefined();
      expect(typeof response.headers['x-trace-id']).toBe('string');
    });

    it('should use custom trace_id from request header', async () => {
      const customTraceId = 'test-trace-id-123';

      const response = await app.inject({
        method: 'GET',
        url: '/health',
        headers: {
          'x-trace-id': customTraceId,
        },
      });

      expect(response.headers['x-trace-id']).toBe(customTraceId);

      const json = response.json() as { trace_id: string };
      expect(json.trace_id).toBe(customTraceId);
    });

    it('should return incrementing uptime', async () => {
      const response1 = await app.inject({
        method: 'GET',
        url: '/health',
      });

      const json1 = response1.json() as { data: { uptime: number } };
      const uptime1 = json1.data.uptime;

      // Wait 1 second
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const response2 = await app.inject({
        method: 'GET',
        url: '/health',
      });

      const json2 = response2.json() as { data: { uptime: number } };
      const uptime2 = json2.data.uptime;

      expect(uptime2).toBeGreaterThanOrEqual(uptime1 + 1);
    });
  });

  describe('404 Handler', () => {
    it('should return 404 for non-existent routes', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/non-existent-route',
      });

      expect(response.statusCode).toBe(404);

      const json = response.json() as {
        success: boolean;
        error: {
          code: string;
          message: string;
        };
      };

      expect(json.success).toBe(false);
      expect(json.error.code).toBe('NOT_FOUND');
      expect(json.error.message).toContain('/non-existent-route');
    });
  });
});

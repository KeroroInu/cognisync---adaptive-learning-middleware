/**
 * Health Route
 * Handles health check endpoint
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { HealthController } from '../controllers/healthController.js';
import { successResponse } from '../utils/responses.js';
import { healthResponseSchema } from '../schemas/health.js';

/**
 * Register health routes
 */
export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  const healthController = new HealthController();

  /**
   * GET /health - Health check endpoint
   */
  fastify.get(
    '/health',
    {
      schema: {
        description: 'Health check endpoint',
        tags: ['health'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  time: { type: 'string' },
                  version: { type: 'string' },
                  uptime: { type: 'number' },
                  environment: { type: 'string' },
                },
              },
              timestamp: { type: 'string' },
              trace_id: { type: 'string' },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest & { traceId: string },
      reply: FastifyReply,
    ): Promise<void> => {
      const health = await healthController.getHealth();

      // Validate response
      healthResponseSchema.parse(health);

      void reply.send(successResponse(health, request.traceId));
    },
  );
}

/**
 * Request Logging Middleware
 * Adds trace_id to each request and logs request/response details
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'crypto';
import { createChildLogger } from '../utils/logger.js';

/**
 * Generate or extract trace ID from request
 */
function getTraceId(request: FastifyRequest): string {
  const headerTraceId = request.headers['x-trace-id'];
  if (typeof headerTraceId === 'string' && headerTraceId.length > 0) {
    return headerTraceId;
  }
  return randomUUID();
}

/**
 * Register request logging middleware
 */
export async function registerRequestLogging(fastify: FastifyInstance): Promise<void> {
  // Add trace_id to request
  fastify.addHook('onRequest', async (request: FastifyRequest, _reply: FastifyReply) => {
    const traceId = getTraceId(request);
    (request as FastifyRequest & { traceId: string }).traceId = traceId;
    (request as FastifyRequest & { log: ReturnType<typeof createChildLogger> }).log =
      createChildLogger(traceId);
  });

  // Log incoming requests
  fastify.addHook(
    'onRequest',
    async (request: FastifyRequest & { traceId: string }, _reply: FastifyReply) => {
      request.log.info(
        {
          method: request.method,
          url: request.url,
          headers: request.headers,
          query: request.query,
        },
        'Incoming request',
      );
    },
  );

  // Log responses
  fastify.addHook(
    'onResponse',
    async (
      request: FastifyRequest & { traceId: string },
      reply: FastifyReply,
    ) => {
      const responseTime = reply.getResponseTime();
      request.log.info(
        {
          method: request.method,
          url: request.url,
          statusCode: reply.statusCode,
          responseTime: `${responseTime.toFixed(2)}ms`,
        },
        'Request completed',
      );
    },
  );

  // Add trace_id to response headers
  fastify.addHook(
    'onSend',
    async (
      request: FastifyRequest & { traceId: string },
      reply: FastifyReply,
      payload: unknown,
    ) => {
      void reply.header('X-Trace-Id', request.traceId);
      return payload;
    },
  );
}

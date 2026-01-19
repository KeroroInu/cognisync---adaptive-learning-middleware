/**
 * Fastify Application Factory
 * Creates and configures the Fastify server instance
 */

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { registerRequestLogging } from '../middlewares/requestLogging.js';
import { registerErrorHandler } from '../middlewares/errorHandler.js';
import { healthRoutes } from '../routes/health.js';

/**
 * Create and configure Fastify app
 */
export async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger,
    disableRequestLogging: true, // We use custom request logging
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'request_id',
  });

  // Security headers
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
  });

  // CORS configuration
  await app.register(cors, {
    origin: config.cors.origins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Trace-Id', 'X-Request-Id'],
    exposedHeaders: ['X-Trace-Id', 'X-Request-Id'],
  });

  // Swagger/OpenAPI documentation
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'CogniSync Backend API',
        description: 'Enterprise-grade backend API for CogniSync adaptive learning platform',
        version: config.appVersion,
        contact: {
          name: 'CogniSync Team',
          email: 'team@cognisync.dev',
        },
        license: {
          name: 'MIT',
          url: 'https://opensource.org/licenses/MIT',
        },
      },
      servers: [
        {
          url: `http://localhost:${config.port}`,
          description: 'Development server',
        },
        {
          url: 'https://api.cognisync.dev',
          description: 'Production server',
        },
      ],
      tags: [
        { name: 'health', description: 'Health check endpoints' },
        { name: 'profile', description: 'User profile management' },
        { name: 'chat', description: 'Chat interaction endpoints' },
        { name: 'knowledge-graph', description: 'Knowledge graph management' },
        { name: 'calibration', description: 'Calibration and alignment endpoints' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  });

  // Swagger UI
  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      displayRequestDuration: true,
    },
    staticCSP: true,
  });

  // Register middlewares
  await registerRequestLogging(app);
  await registerErrorHandler(app);

  // Register routes
  await app.register(healthRoutes);

  // 404 handler
  app.setNotFoundHandler(async (request, reply) => {
    void reply.status(404).send({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: `Route ${request.method} ${request.url} not found`,
      },
      timestamp: new Date().toISOString(),
    });
  });

  return app;
}

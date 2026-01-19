/**
 * Server Entry Point
 * Starts the Fastify server
 */

import { createApp } from './app.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

/**
 * Graceful shutdown handler
 */
async function gracefulShutdown(signal: string, app: Awaited<ReturnType<typeof createApp>>): Promise<void> {
  logger.info(`Received ${signal}, starting graceful shutdown`);

  try {
    await app.close();
    logger.info('Server closed successfully');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Error during shutdown');
    process.exit(1);
  }
}

/**
 * Start server
 */
async function start(): Promise<void> {
  try {
    // Create app
    const app = await createApp();

    // Register shutdown handlers
    process.on('SIGTERM', () => void gracefulShutdown('SIGTERM', app));
    process.on('SIGINT', () => void gracefulShutdown('SIGINT', app));

    // Start listening
    await app.listen({
      port: config.port,
      host: config.host,
    });

    logger.info(
      {
        port: config.port,
        host: config.host,
        env: config.nodeEnv,
        version: config.appVersion,
      },
      'Server started successfully',
    );

    logger.info(`📚 API Documentation: http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}/docs`);
    logger.info(`❤️  Health Check: http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}/health`);
  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }
}

// Start the server
void start();

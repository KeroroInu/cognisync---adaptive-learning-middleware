/**
 * Logging Utility
 * Configures Pino logger with trace_id support
 */

import pino from 'pino';
import { config } from './config.js';

/**
 * Custom serializers for better log formatting
 */
const serializers = {
  req: (req: {
    method?: string;
    url?: string;
    headers?: Record<string, unknown>;
    remoteAddress?: string;
  }) => ({
    method: req.method,
    url: req.url,
    headers: req.headers,
    remoteAddress: req.remoteAddress,
  }),
  res: (res: { statusCode?: number }) => ({
    statusCode: res.statusCode,
  }),
  err: pino.stdSerializers.err,
};

/**
 * Logger instance configuration
 */
export const logger = pino({
  level: config.logging.level,
  serializers,
  ...(config.logging.pretty && config.nodeEnv === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
      }
    : {}),
  formatters: {
    level: (label: string) => ({ level: label }),
  },
  base: {
    env: config.nodeEnv,
    version: config.appVersion,
  },
});

/**
 * Child logger with trace_id
 */
export function createChildLogger(traceId: string): pino.Logger {
  return logger.child({ trace_id: traceId });
}

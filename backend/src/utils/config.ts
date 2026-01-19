/**
 * Configuration Management
 * Centralized configuration loader using environment variables
 */

import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables
dotenv.config();

/**
 * Configuration schema using Zod for runtime validation
 */
const configSchema = z.object({
  // Application
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  port: z.coerce.number().int().min(1).max(65535).default(8000),
  host: z.string().default('0.0.0.0'),
  appVersion: z.string().default('1.0.0'),

  // Neo4j
  neo4j: z.object({
    uri: z.string().url().default('neo4j://localhost:7687'),
    user: z.string().default('neo4j'),
    password: z.string().min(1),
  }),

  // LLM Providers
  llm: z.object({
    openai: z
      .object({
        apiKey: z.string().optional(),
        model: z.string().default('gpt-4'),
      })
      .optional(),
    anthropic: z
      .object({
        apiKey: z.string().optional(),
        model: z.string().default('claude-3-sonnet-20240229'),
      })
      .optional(),
  }),

  // CORS
  cors: z.object({
    origins: z
      .string()
      .transform((str) => str.split(','))
      .default('http://localhost:3000'),
  }),

  // Logging
  logging: z.object({
    level: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    pretty: z
      .string()
      .transform((val) => val === 'true')
      .default('true'),
  }),

  // Security
  security: z.object({
    jwtSecret: z.string().min(32),
    jwtExpiresIn: z.string().default('7d'),
  }),

  // Rate Limiting
  rateLimit: z.object({
    max: z.coerce.number().int().positive().default(100),
    window: z.coerce.number().int().positive().default(60000),
  }),
});

export type Config = z.infer<typeof configSchema>;

/**
 * Parse and validate configuration
 */
function loadConfig(): Config {
  const rawConfig = {
    nodeEnv: process.env.NODE_ENV,
    port: process.env.PORT,
    host: process.env.HOST,
    appVersion: process.env.APP_VERSION,
    neo4j: {
      uri: process.env.NEO4J_URI,
      user: process.env.NEO4J_USER,
      password: process.env.NEO4J_PASSWORD,
    },
    llm: {
      openai: {
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL,
      },
      anthropic: {
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: process.env.ANTHROPIC_MODEL,
      },
    },
    cors: {
      origins: process.env.CORS_ORIGINS,
    },
    logging: {
      level: process.env.LOG_LEVEL,
      pretty: process.env.LOG_PRETTY,
    },
    security: {
      jwtSecret: process.env.JWT_SECRET,
      jwtExpiresIn: process.env.JWT_EXPIRES_IN,
    },
    rateLimit: {
      max: process.env.RATE_LIMIT_MAX,
      window: process.env.RATE_LIMIT_WINDOW,
    },
  };

  const result = configSchema.safeParse(rawConfig);

  if (!result.success) {
    console.error('❌ Configuration validation failed:');
    console.error(result.error.format());
    throw new Error('Invalid configuration');
  }

  return result.data;
}

/**
 * Singleton configuration instance
 */
export const config = loadConfig();

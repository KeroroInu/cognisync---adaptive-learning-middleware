/**
 * Health Check Schema
 * Zod schemas for health endpoint validation
 */

import { z } from 'zod';

/**
 * Health response schema
 */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  time: z.string().datetime(),
  version: z.string(),
  uptime: z.number(),
  environment: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

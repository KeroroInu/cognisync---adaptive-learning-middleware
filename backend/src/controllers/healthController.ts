/**
 * Health Controller
 * Business logic for health check endpoint
 */

import type { HealthResponse } from '../schemas/health.js';
import { config } from '../utils/config.js';

/**
 * Get application health status
 */
export class HealthController {
  private readonly startTime: number;

  constructor() {
    this.startTime = Date.now();
  }

  /**
   * Get health check information
   */
  async getHealth(): Promise<HealthResponse> {
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);

    return {
      status: 'ok',
      time: new Date().toISOString(),
      version: config.appVersion,
      uptime,
      environment: config.nodeEnv,
    };
  }
}

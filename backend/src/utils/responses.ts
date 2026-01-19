/**
 * Response Utilities
 * Standardized response formatters for consistent API responses
 */

/**
 * Success response structure
 */
export interface SuccessResponse<T = unknown> {
  success: true;
  data: T;
  timestamp: string;
  trace_id?: string;
}

/**
 * Error response structure
 */
export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  timestamp: string;
  trace_id?: string;
}

/**
 * Create a success response
 */
export function successResponse<T>(data: T, traceId?: string): SuccessResponse<T> {
  return {
    success: true,
    data,
    timestamp: new Date().toISOString(),
    ...(traceId && { trace_id: traceId }),
  };
}

/**
 * Create an error response
 */
export function errorResponse(
  code: string,
  message: string,
  traceId?: string,
  details?: Record<string, unknown>,
): ErrorResponse {
  return {
    success: false,
    error: {
      code,
      message,
      ...(details && { details }),
    },
    timestamp: new Date().toISOString(),
    ...(traceId && { trace_id: traceId }),
  };
}

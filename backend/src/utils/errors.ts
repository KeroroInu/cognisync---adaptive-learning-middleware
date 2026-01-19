/**
 * Custom Error Classes
 * Provides structured error handling with consistent error codes
 */

export interface AppErrorOptions {
  code: string;
  message: string;
  statusCode: number;
  details?: Record<string, unknown>;
}

/**
 * Base application error class
 */
export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;
  public readonly isOperational: boolean;

  constructor(options: AppErrorOptions) {
    super(options.message);
    this.name = this.constructor.name;
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.details = options.details;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Validation error (400)
 */
export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super({
      code: 'VALIDATION_ERROR',
      message,
      statusCode: 400,
      details,
    });
  }
}

/**
 * Not Found error (404)
 */
export class NotFoundError extends AppError {
  constructor(resource: string, identifier?: string) {
    super({
      code: 'NOT_FOUND',
      message: identifier
        ? `${resource} not found: ${identifier}`
        : `${resource} not found`,
      statusCode: 404,
    });
  }
}

/**
 * Conflict error (409)
 */
export class ConflictError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super({
      code: 'CONFLICT',
      message,
      statusCode: 409,
      details,
    });
  }
}

/**
 * Internal Server error (500)
 */
export class InternalError extends AppError {
  constructor(message: string = 'Internal server error', details?: Record<string, unknown>) {
    super({
      code: 'INTERNAL_ERROR',
      message,
      statusCode: 500,
      details,
    });
  }
}

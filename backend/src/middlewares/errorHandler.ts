/**
 * Error Handler Middleware
 * Global error handling with standardized error responses
 */

import type { FastifyInstance, FastifyRequest, FastifyReply, FastifyError } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';
import { errorResponse } from '../utils/responses.js';

/**
 * Handle Zod validation errors
 */
function handleZodError(error: ZodError, traceId: string): {
  statusCode: number;
  response: ReturnType<typeof errorResponse>;
} {
  const details = error.errors.reduce(
    (acc, err) => {
      const path = err.path.join('.');
      acc[path] = err.message;
      return acc;
    },
    {} as Record<string, string>,
  );

  return {
    statusCode: 400,
    response: errorResponse('VALIDATION_ERROR', 'Validation failed', traceId, details),
  };
}

/**
 * Handle application errors
 */
function handleAppError(error: AppError, traceId: string): {
  statusCode: number;
  response: ReturnType<typeof errorResponse>;
} {
  return {
    statusCode: error.statusCode,
    response: errorResponse(error.code, error.message, traceId, error.details),
  };
}

/**
 * Handle Fastify validation errors
 */
function handleFastifyValidationError(
  error: FastifyError,
  traceId: string,
): {
  statusCode: number;
  response: ReturnType<typeof errorResponse>;
} {
  return {
    statusCode: 400,
    response: errorResponse('VALIDATION_ERROR', error.message, traceId, {
      validation: error.validation,
    }),
  };
}

/**
 * Handle unknown errors
 */
function handleUnknownError(error: Error, traceId: string): {
  statusCode: number;
  response: ReturnType<typeof errorResponse>;
} {
  return {
    statusCode: 500,
    response: errorResponse('INTERNAL_ERROR', 'Internal server error', traceId, {
      message: error.message,
    }),
  };
}

/**
 * Register global error handler
 */
export async function registerErrorHandler(fastify: FastifyInstance): Promise<void> {
  fastify.setErrorHandler(
    async (
      error: Error | FastifyError | AppError | ZodError,
      request: FastifyRequest & { traceId: string },
      reply: FastifyReply,
    ) => {
      const traceId = request.traceId ?? 'unknown';

      // Log error
      request.log.error(
        {
          err: error,
          trace_id: traceId,
          method: request.method,
          url: request.url,
        },
        'Error occurred',
      );

      let statusCode: number;
      let response: ReturnType<typeof errorResponse>;

      // Determine error type and format response
      if (error instanceof ZodError) {
        ({ statusCode, response } = handleZodError(error, traceId));
      } else if (error instanceof AppError) {
        ({ statusCode, response } = handleAppError(error, traceId));
      } else if ('validation' in error) {
        ({ statusCode, response } = handleFastifyValidationError(error as FastifyError, traceId));
      } else {
        ({ statusCode, response } = handleUnknownError(error, traceId));
      }

      // Send error response
      void reply.status(statusCode).send(response);
    },
  );
}

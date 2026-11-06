import type { ErrorRequestHandler } from 'express';
import { AppError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';

interface BodyParserError {
  type: string;
}

function isBodyParserError(err: unknown): err is BodyParserError {
  return typeof err === 'object' && err !== null && typeof (err as BodyParserError).type === 'string';
}

/** Converts errors we expect (our own, plus JSON body errors) into AppErrors. */
function toAppError(err: unknown): AppError | undefined {
  if (err instanceof AppError) return err;
  if (isBodyParserError(err)) {
    if (err.type === 'entity.too.large')
      return new AppError('PAYLOAD_TOO_LARGE', 'Request body is too large');
    if (err.type === 'entity.parse.failed') return new AppError('VALIDATION_ERROR', 'Malformed JSON body');
  }
  return undefined;
}

/**
 * Last middleware: turns any error into the standard `{ error: { code, message, details? } }` shape.
 * Unexpected errors are logged in full but reported to the client only as 500 INTERNAL.
 */
export function errorHandler(options: { logger: Logger; exposeStack: boolean }): ErrorRequestHandler {
  const { logger, exposeStack } = options;
  return (err, _req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }

    const appError = toAppError(err);
    if (appError) {
      if (appError.status >= 500) logger.error({ err }, appError.message);
      res.status(appError.status).json({
        error: {
          code: appError.code,
          message: appError.message,
          ...(appError.details !== undefined && { details: appError.details }),
        },
      });
      return;
    }

    logger.error({ err }, 'Unhandled error');
    res.status(500).json({
      error: {
        code: 'INTERNAL',
        message: 'Internal server error',
        ...(exposeStack && err instanceof Error && { stack: err.stack }),
      },
    });
  };
}

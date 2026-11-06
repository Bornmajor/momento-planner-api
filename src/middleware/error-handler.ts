import type { ErrorRequestHandler } from 'express';
import { AppError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';

/** Errors thrown by express.json (body-parser) carry a `type` and an HTTP `status`. */
interface BodyParserError {
  type: string;
  status: number;
}

function isBodyParserError(err: unknown): err is BodyParserError {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as BodyParserError).type === 'string' &&
    typeof (err as BodyParserError).status === 'number'
  );
}

/** Converts errors we expect (our own, plus request-body errors) into AppErrors. */
function toAppError(err: unknown): AppError | undefined {
  if (err instanceof AppError) return err;
  if (isBodyParserError(err) && err.status >= 400 && err.status < 500) {
    // Every body-parser client error (bad JSON, unsupported charset or encoding, aborted upload)
    // is the client's mistake, so none of them should surface as 500 INTERNAL.
    if (err.type === 'entity.too.large')
      return new AppError('PAYLOAD_TOO_LARGE', 'Request body is too large');
    if (err.type === 'entity.parse.failed') return new AppError('VALIDATION_ERROR', 'Malformed JSON body');
    return new AppError('VALIDATION_ERROR', 'Invalid request body');
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
      // 5xx AppErrors are logged with their `cause`, which may hold internal detail never sent to clients.
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

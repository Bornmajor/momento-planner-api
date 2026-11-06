import { rateLimit } from 'express-rate-limit';
import { AppError } from '../lib/errors.js';

const FIFTEEN_MINUTES = 15 * 60_000;

/** Per-IP request limit that fails with the standard 429 RATE_LIMITED error shape. */
export function createRateLimiter(limit: number, windowMs = FIFTEEN_MINUTES) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(new AppError('RATE_LIMITED', 'Too many requests, please try again later'));
    },
  });
}

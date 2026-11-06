import { describe, expect, it } from 'vitest';
import { AppError, ERROR_STATUS } from '../../../src/lib/errors.js';

describe('errors', () => {
  it('maps every error code to its HTTP status (spec §7)', () => {
    expect(ERROR_STATUS).toEqual({
      VALIDATION_ERROR: 400,
      UNAUTHENTICATED: 401,
      INVALID_CREDENTIALS: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      EMAIL_TAKEN: 409,
      SAVED_LIMIT_REACHED: 409,
      PAYLOAD_TOO_LARGE: 413,
      RATE_LIMITED: 429,
      AI_LIMIT_REACHED: 429,
      INTERNAL: 500,
      UPSTREAM_UNAVAILABLE: 502,
    });
  });

  it('AppError carries code, status, message and details', () => {
    const err = new AppError('EMAIL_TAKEN', 'Email already registered', [{ field: 'email' }]);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AppError');
    expect(err.code).toBe('EMAIL_TAKEN');
    expect(err.status).toBe(409);
    expect(err.message).toBe('Email already registered');
    expect(err.details).toEqual([{ field: 'email' }]);
  });
});

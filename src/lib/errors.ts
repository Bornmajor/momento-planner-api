/** Every error code the API can return, with its HTTP status (spec §7). */
export const ERROR_STATUS = {
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
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

/** An expected error that is safe to show to the client. Anything else becomes 500 INTERNAL. */
export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = ERROR_STATUS[code];
  }
}

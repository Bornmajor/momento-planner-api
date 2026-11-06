import type { UserDocument } from '../models/user.model.js';

declare global {
  namespace Express {
    interface Request {
      /** Values parsed by the `validate` middleware. */
      valid: { params?: unknown; query?: unknown; body?: unknown };
      /** The signed-in user, set by `requireAuth`. */
      user?: UserDocument;
    }
  }
}

export {};

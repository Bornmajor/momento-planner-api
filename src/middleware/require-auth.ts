import type { RequestHandler } from 'express';
import { isValidObjectId } from 'mongoose';
import { AppError } from '../lib/errors.js';
import { User } from '../models/user.model.js';
import type { TokenService } from '../modules/auth/tokens.js';

const unauthenticated = () => new AppError('UNAUTHENTICATED', 'Authentication required');

/** Requires `Authorization: Bearer <access token>` for an existing user, and sets `req.user`. */
export function createRequireAuth(deps: { tokens: Pick<TokenService, 'verifyAccessToken'> }): RequestHandler {
  return async (req, _res, next) => {
    const match = /^Bearer (\S+)$/.exec(req.get('authorization') ?? '');
    if (!match) throw unauthenticated();

    const { userId } = await deps.tokens.verifyAccessToken(match[1]!);
    if (!isValidObjectId(userId)) throw unauthenticated();

    const user = await User.findById(userId);
    if (!user) throw unauthenticated();

    req.user = user;
    next();
  };
}

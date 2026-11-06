import type { RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';

export const notFound: RequestHandler = (req, _res, next) => {
  next(new AppError('NOT_FOUND', `Route ${req.method} ${req.path} not found`));
};

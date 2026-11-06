import { Router } from 'express';
import { createRateLimiter } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import {
  googleSchema,
  loginSchema,
  refreshTokenSchema,
  registerSchema,
  type LoginInput,
  type RegisterInput,
} from './auth.schemas.js';
import type { AuthService } from './auth.service.js';

export interface AuthRateLimits {
  /** Requests per 15 minutes per IP, shared by register, login and Google sign-in. */
  auth: number;
  /** Requests per 15 minutes per IP for refresh. */
  refresh: number;
}

export function createAuthRouter(deps: { auth: AuthService; rateLimits: AuthRateLimits }): Router {
  const { auth } = deps;
  const router = Router();
  const authLimiter = createRateLimiter(deps.rateLimits.auth);
  const refreshLimiter = createRateLimiter(deps.rateLimits.refresh);

  router.post('/register', authLimiter, validate({ body: registerSchema }), async (req, res) => {
    res.status(201).json(await auth.register(req.body as RegisterInput));
  });

  router.post('/login', authLimiter, validate({ body: loginSchema }), async (req, res) => {
    res.json(await auth.login(req.body as LoginInput));
  });

  router.post('/google', authLimiter, validate({ body: googleSchema }), async (req, res) => {
    res.json(await auth.loginWithGoogle((req.body as { idToken: string }).idToken));
  });

  router.post('/refresh', refreshLimiter, validate({ body: refreshTokenSchema }), async (req, res) => {
    res.json(await auth.refresh((req.body as { refreshToken: string }).refreshToken));
  });

  router.post('/logout', refreshLimiter, validate({ body: refreshTokenSchema }), async (req, res) => {
    await auth.logout((req.body as { refreshToken: string }).refreshToken);
    res.status(204).end();
  });

  return router;
}

import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Services } from './container.js';
import { API_PREFIX } from './lib/app-info.js';
import { isDbConnected } from './lib/db.js';
import type { Logger } from './lib/logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFound } from './middleware/not-found.js';
import { createRequireAuth } from './middleware/require-auth.js';
import { createAuthRouter, type AuthRateLimits } from './modules/auth/auth.routes.js';
import { createEventsRouter } from './modules/events/events.routes.js';
import { createPersonalizeRouter } from './modules/personalize/personalize.routes.js';
import { createSavedEventsRouter } from './modules/saved-events/saved-events.routes.js';
import { createUsersRouter } from './modules/users/users.routes.js';

export type RateLimits = AuthRateLimits;

/** Spec §6: 10 auth attempts and 30 refreshes per 15 minutes per IP. */
export const DEFAULT_RATE_LIMITS: RateLimits = { auth: 10, refresh: 30 };

export interface AppDeps {
  logger: Logger;
  /** The feature services. Without them only /health is served (used by the app-shell tests). */
  services?: Services;
  rateLimits?: RateLimits;
  /** Reports database health for /health. Defaults to the real Mongoose connection state. */
  isDbUp?: () => boolean;
  /** Include stack traces in 500 responses. Development only. */
  exposeStack?: boolean;
}

/** Builds the Express app without listening, so tests can drive it with supertest. */
export function createApp(deps: AppDeps): Express {
  const isDbUp = deps.isDbUp ?? isDbConnected;
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    pinoHttp({
      logger: deps.logger,
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', db: isDbUp() ? 'up' : 'down' });
  });

  const api = express.Router();
  if (deps.services) {
    const { services } = deps;
    const requireAuth = createRequireAuth({ tokens: services.tokens });
    api.use(
      '/auth',
      createAuthRouter({ auth: services.auth, rateLimits: deps.rateLimits ?? DEFAULT_RATE_LIMITS }),
    );
    api.use(createUsersRouter({ requireAuth }));
    api.use('/me/saved-events', createSavedEventsRouter({ savedEvents: services.savedEvents, requireAuth }));
    api.use('/events', createPersonalizeRouter({ personalize: services.personalize, requireAuth }));
    api.use('/events', createEventsRouter({ events: services.events, requireAuth }));
  }
  app.use(API_PREFIX, api);

  app.use(notFound);
  app.use(errorHandler({ logger: deps.logger, exposeStack: deps.exposeStack ?? false }));
  return app;
}

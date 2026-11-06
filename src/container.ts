import { createAuthService } from './modules/auth/auth.service.js';
import type { GoogleVerifier } from './modules/auth/google-verifier.js';
import { DEFAULT_BCRYPT_ROUNDS } from './modules/auth/password.js';
import { createTokenService } from './modules/auth/tokens.js';
import type { EventProvider } from './modules/events/event.types.js';
import { createPersonalizeService } from './modules/personalize/personalize.service.js';
import { createSavedEventsService } from './modules/saved-events/saved-events.service.js';
import type { AiProvider } from './providers/ai/ai-provider.js';

export interface ServicesConfig {
  jwtAccessSecret: string;
  accessTokenTtl: string;
  refreshTokenTtlDays: number;
  googleVerifier: GoogleVerifier;
  eventProvider: EventProvider;
  aiProvider: AiProvider;
  aiDailyLimitPerUser: number;
  bcryptRounds?: number;
  now?: () => Date;
}

/** Builds the app's services. The server passes real dependencies; tests pass fakes. */
export function createServices(config: ServicesConfig) {
  const now = config.now;
  const tokens = createTokenService({
    secret: config.jwtAccessSecret,
    accessTtl: config.accessTokenTtl,
    refreshTtlDays: config.refreshTokenTtlDays,
    ...(now && { now }),
  });
  const auth = createAuthService({
    tokens,
    googleVerifier: config.googleVerifier,
    bcryptRounds: config.bcryptRounds ?? DEFAULT_BCRYPT_ROUNDS,
  });
  const events = config.eventProvider;
  const savedEvents = createSavedEventsService({ events });
  const personalize = createPersonalizeService({
    events,
    ai: config.aiProvider,
    dailyLimit: config.aiDailyLimitPerUser,
    ...(now && { now }),
  });
  return { tokens, auth, events, savedEvents, personalize };
}

export type Services = ReturnType<typeof createServices>;

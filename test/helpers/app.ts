import type { Express } from 'express';
import request from 'supertest';
import { createApp, type RateLimits } from '../../src/app.js';
import { createServices } from '../../src/container.js';
import { AppError } from '../../src/lib/errors.js';
import type { GoogleProfile, GoogleVerifier } from '../../src/modules/auth/google-verifier.js';
import type { EventProvider } from '../../src/modules/events/event.types.js';
import type { AiProvider } from '../../src/providers/ai/ai-provider.js';
import { createFakeAiProvider } from '../../src/providers/ai/fake-ai.provider.js';
import { fakeEventProvider } from './events.js';
import { captureLogger } from './logger.js';

export const TEST_JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-bytes-long';

/** Accepts only the ID tokens listed in `profiles`. */
export function fakeGoogleVerifier(profiles: Record<string, GoogleProfile> = {}): GoogleVerifier {
  return {
    async verify(idToken) {
      const profile = profiles[idToken];
      if (!profile) throw new AppError('UNAUTHENTICATED', 'Invalid Google token');
      return profile;
    },
  };
}

export interface TestAppOptions {
  google?: Record<string, GoogleProfile>;
  rateLimits?: RateLimits;
  now?: () => Date;
  eventProvider?: EventProvider;
  aiProvider?: AiProvider;
  aiDailyLimit?: number;
}

/** The full app wired with test settings: fast bcrypt, fake Google, very high rate limits by default. */
export function buildTestApp(options: TestAppOptions = {}) {
  const log = captureLogger();
  const services = createServices({
    jwtAccessSecret: TEST_JWT_SECRET,
    accessTokenTtl: '15m',
    refreshTokenTtlDays: 30,
    bcryptRounds: 4,
    googleVerifier: fakeGoogleVerifier(options.google),
    eventProvider: options.eventProvider ?? fakeEventProvider(),
    aiProvider: options.aiProvider ?? createFakeAiProvider(),
    aiDailyLimitPerUser: options.aiDailyLimit ?? 20,
    ...(options.now && { now: options.now }),
  });
  const app = createApp({
    logger: log.logger,
    isDbUp: () => true,
    services,
    rateLimits: options.rateLimits ?? { auth: 10_000, refresh: 10_000 },
  });
  return { app, services, log };
}

export const ADA = {
  email: 'ada@example.com',
  password: 'Passw0rd!',
  firstName: 'Ada',
  lastName: 'Lovelace',
};

export function registerUser(app: Express, overrides: Partial<typeof ADA> = {}) {
  return request(app)
    .post('/api/v1/auth/register')
    .send({ ...ADA, ...overrides });
}

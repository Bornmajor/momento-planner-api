import { createAuthService } from './modules/auth/auth.service.js';
import type { GoogleVerifier } from './modules/auth/google-verifier.js';
import { DEFAULT_BCRYPT_ROUNDS } from './modules/auth/password.js';
import { createTokenService } from './modules/auth/tokens.js';

export interface ServicesConfig {
  jwtAccessSecret: string;
  accessTokenTtl: string;
  refreshTokenTtlDays: number;
  googleVerifier: GoogleVerifier;
  bcryptRounds?: number;
  now?: () => Date;
}

/** Builds the app's services. The server passes real dependencies; tests pass fakes. */
export function createServices(config: ServicesConfig) {
  const tokens = createTokenService({
    secret: config.jwtAccessSecret,
    accessTtl: config.accessTokenTtl,
    refreshTtlDays: config.refreshTokenTtlDays,
    ...(config.now && { now: config.now }),
  });
  const auth = createAuthService({
    tokens,
    googleVerifier: config.googleVerifier,
    bcryptRounds: config.bcryptRounds ?? DEFAULT_BCRYPT_ROUNDS,
  });
  return { tokens, auth };
}

export type Services = ReturnType<typeof createServices>;

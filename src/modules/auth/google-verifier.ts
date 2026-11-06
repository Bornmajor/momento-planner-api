import { OAuth2Client } from 'google-auth-library';
import { AppError } from '../../lib/errors.js';

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  givenName?: string;
  familyName?: string;
}

export interface GoogleVerifier {
  verify(idToken: string): Promise<GoogleProfile>;
}

interface GoogleIdTokenPayload {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  given_name?: string;
  family_name?: string;
}

/** The part of google-auth-library's OAuth2Client we use, so tests can pass a fake. */
export interface IdTokenClient {
  verifyIdToken(options: {
    idToken: string;
    audience: string[];
  }): Promise<{ getPayload(): GoogleIdTokenPayload | undefined }>;
}

const invalid = () => new AppError('UNAUTHENTICATED', 'Invalid Google token');

/**
 * Verifies a Google ID token's signature, expiry, issuer and audience (one of our OAuth client IDs).
 * With no client IDs configured, Google sign-in is disabled and every token is rejected.
 */
export function createGoogleVerifier(
  clientIds: string[],
  client: IdTokenClient = new OAuth2Client(),
): GoogleVerifier {
  return {
    async verify(idToken) {
      if (clientIds.length === 0) throw invalid();

      let payload: GoogleIdTokenPayload | undefined;
      try {
        payload = (await client.verifyIdToken({ idToken, audience: clientIds })).getPayload();
      } catch {
        throw invalid();
      }
      if (!payload?.sub || !payload.email) throw invalid();

      return {
        sub: payload.sub,
        email: payload.email,
        emailVerified: payload.email_verified === true,
        ...(payload.given_name && { givenName: payload.given_name }),
        ...(payload.family_name && { familyName: payload.family_name }),
      };
    },
  };
}

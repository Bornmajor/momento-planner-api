import bcrypt from 'bcryptjs';
import { AppError } from '../../lib/errors.js';
import { User, type UserDocument } from '../../models/user.model.js';
import type { LoginInput, RegisterInput } from './auth.schemas.js';
import type { GoogleVerifier } from './google-verifier.js';
import { hashPassword, verifyPassword } from './password.js';
import type { TokenService } from './tokens.js';

export interface AuthServiceDeps {
  tokens: TokenService;
  googleVerifier: GoogleVerifier;
  bcryptRounds: number;
}

export type AuthService = ReturnType<typeof createAuthService>;

const isDuplicateKeyError = (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;

const emailTaken = () => new AppError('EMAIL_TAKEN', 'An account with this email already exists');
const invalidCredentials = () => new AppError('INVALID_CREDENTIALS', 'Invalid email or password');

export function createAuthService({ tokens, googleVerifier, bcryptRounds }: AuthServiceDeps) {
  // Compared against when the email is unknown, so the response takes as long as a real check.
  const dummyHash = bcrypt.hashSync('timing-equalizer-password-1', bcryptRounds);

  async function issueTokens(user: UserDocument) {
    return {
      accessToken: await tokens.signAccessToken(user.id),
      refreshToken: await tokens.issueRefreshToken(user.id),
    };
  }

  async function register(input: RegisterInput) {
    if (await User.exists({ email: input.email })) throw emailTaken();
    let user: UserDocument;
    try {
      user = await User.create({
        email: input.email,
        passwordHash: await hashPassword(input.password, bcryptRounds),
        firstName: input.firstName,
        lastName: input.lastName,
      });
    } catch (err) {
      if (isDuplicateKeyError(err)) throw emailTaken();
      throw err;
    }
    return { user, ...(await issueTokens(user)) };
  }

  async function login(input: LoginInput) {
    const user = await User.findOne({ email: input.email });
    const passwordMatches = await verifyPassword(input.password, user?.passwordHash ?? dummyHash);
    if (!user?.passwordHash || !passwordMatches) throw invalidCredentials();
    return { user, ...(await issueTokens(user)) };
  }

  /**
   * Signs in with a Google ID token. Looks up the user by Google id, then links to an existing
   * account with the same email only if Google verified that email; otherwise creates a new user.
   */
  async function loginWithGoogle(idToken: string) {
    const profile = await googleVerifier.verify(idToken);
    const email = profile.email.toLowerCase();

    let user = await User.findOne({ googleId: profile.sub });
    let isNewUser = false;

    if (!user) {
      const existing = await User.findOne({ email });
      if (existing) {
        if (!profile.emailVerified) throw emailTaken();
        existing.googleId = profile.sub;
        user = await existing.save();
      } else {
        user = await User.create({
          email,
          googleId: profile.sub,
          firstName: (profile.givenName ?? email.split('@')[0] ?? 'User').slice(0, 50),
          lastName: (profile.familyName ?? '').slice(0, 50),
        });
        isNewUser = true;
      }
    }

    return { user, ...(await issueTokens(user)), isNewUser };
  }

  async function refresh(refreshToken: string) {
    const rotated = await tokens.rotateRefreshToken(refreshToken);
    if (!(await User.exists({ _id: rotated.userId }))) {
      throw new AppError('UNAUTHENTICATED', 'Invalid or expired token');
    }
    return { accessToken: await tokens.signAccessToken(rotated.userId), refreshToken: rotated.refreshToken };
  }

  async function logout(refreshToken: string) {
    await tokens.revokeRefreshToken(refreshToken);
  }

  return { register, login, loginWithGoogle, refresh, logout };
}

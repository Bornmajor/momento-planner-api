import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { AppError } from '../../lib/errors.js';
import { RefreshToken } from '../../models/refresh-token.model.js';

export interface TokenServiceConfig {
  secret: string;
  /** e.g. "15m", "1h", "30s" */
  accessTtl: string;
  refreshTtlDays: number;
  now?: () => Date;
}

export type TokenService = ReturnType<typeof createTokenService>;

const UNITS = { s: 1, m: 60, h: 3600, d: 86_400 } as const;

export function parseDurationSeconds(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) throw new Error(`Invalid duration: ${value}`);
  return Number(match[1]) * UNITS[match[2] as keyof typeof UNITS];
}

const hashToken = (raw: string) => createHash('sha256').update(raw).digest('hex');
const unauthenticated = () => new AppError('UNAUTHENTICATED', 'Invalid or expired token');

/**
 * Access tokens: short-lived HS256 JWTs carrying the user id as `sub`.
 * Refresh tokens: random strings stored only as a hash, rotated on every use. Presenting a token
 * that was already rotated or revoked revokes its whole chain, because it suggests theft.
 */
export function createTokenService(config: TokenServiceConfig) {
  const key = new TextEncoder().encode(config.secret);
  const accessTtlSeconds = parseDurationSeconds(config.accessTtl);
  const now = config.now ?? (() => new Date());

  async function signAccessToken(userId: string): Promise<string> {
    const issuedAt = Math.floor(now().getTime() / 1000);
    return new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + accessTtlSeconds)
      .sign(key);
  }

  async function verifyAccessToken(token: string): Promise<{ userId: string }> {
    try {
      const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'], currentDate: now() });
      if (!payload.sub) throw unauthenticated();
      return { userId: payload.sub };
    } catch {
      throw unauthenticated();
    }
  }

  async function issueRefreshToken(userId: string, family: string = randomUUID()): Promise<string> {
    return (await createRefreshToken(userId, family)).raw;
  }

  async function createRefreshToken(userId: string, family: string) {
    const raw = randomBytes(32).toString('base64url');
    const doc = await RefreshToken.create({
      userId,
      tokenHash: hashToken(raw),
      family,
      expiresAt: new Date(now().getTime() + config.refreshTtlDays * 86_400_000),
    });
    return { raw, id: doc._id };
  }

  async function revokeFamily(family: string): Promise<void> {
    await RefreshToken.updateMany({ family, revokedAt: null }, { revokedAt: now() });
  }

  async function rotateRefreshToken(raw: string): Promise<{ userId: string; refreshToken: string }> {
    const current = await RefreshToken.findOne({ tokenHash: hashToken(raw) });
    if (!current) throw unauthenticated();

    if (current.revokedAt || current.replacedBy) {
      await revokeFamily(current.family);
      throw unauthenticated();
    }
    if (current.expiresAt.getTime() <= now().getTime()) throw unauthenticated();

    // Claim the token atomically, so two concurrent refreshes can't both succeed.
    const claimed = await RefreshToken.findOneAndUpdate(
      { _id: current._id, revokedAt: null },
      { revokedAt: now() },
    );
    if (!claimed) {
      await revokeFamily(current.family);
      throw unauthenticated();
    }

    const userId = current.userId.toString();
    const next = await createRefreshToken(userId, current.family);
    await RefreshToken.updateOne({ _id: current._id }, { replacedBy: next.id });
    return { userId, refreshToken: next.raw };
  }

  async function revokeRefreshToken(raw: string): Promise<void> {
    await RefreshToken.updateOne({ tokenHash: hashToken(raw), revokedAt: null }, { revokedAt: now() });
  }

  return { signAccessToken, verifyAccessToken, issueRefreshToken, rotateRefreshToken, revokeRefreshToken };
}

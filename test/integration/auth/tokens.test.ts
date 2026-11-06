import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { beforeEach, describe, expect, it } from 'vitest';
import { RefreshToken } from '../../../src/models/refresh-token.model.js';
import { createTokenService } from '../../../src/modules/auth/tokens.js';
import { TEST_JWT_SECRET } from '../../helpers/app.js';
import { useTestDb } from '../../helpers/mongo.js';

useTestDb();

const START = new Date('2026-11-06T10:00:00Z');
let now = START;
const minutes = (n: number) => new Date(START.getTime() + n * 60_000);
const days = (n: number) => new Date(START.getTime() + n * 86_400_000);

const tokens = createTokenService({
  secret: TEST_JWT_SECRET,
  accessTtl: '15m',
  refreshTtlDays: 30,
  now: () => now,
});
const userId = new mongoose.Types.ObjectId().toString();
const unauthenticated = { code: 'UNAUTHENTICATED' };

beforeEach(() => {
  now = START;
});

describe('access tokens', () => {
  it('round-trips the user id', async () => {
    const token = await tokens.signAccessToken(userId);
    await expect(tokens.verifyAccessToken(token)).resolves.toEqual({ userId });
  });

  it('expire after 15 minutes', async () => {
    const token = await tokens.signAccessToken(userId);
    now = minutes(14);
    await expect(tokens.verifyAccessToken(token)).resolves.toEqual({ userId });
    now = minutes(16);
    await expect(tokens.verifyAccessToken(token)).rejects.toMatchObject(unauthenticated);
  });

  it('reject tokens signed with another secret, and garbage', async () => {
    const other = createTokenService({
      secret: 'a-completely-different-secret-of-32-bytes!!',
      accessTtl: '15m',
      refreshTtlDays: 30,
      now: () => now,
    });
    await expect(tokens.verifyAccessToken(await other.signAccessToken(userId))).rejects.toMatchObject(
      unauthenticated,
    );
    await expect(tokens.verifyAccessToken('not-a-jwt')).rejects.toMatchObject(unauthenticated);
  });
});

describe('refresh tokens', () => {
  it('are long random strings, stored only as a SHA-256 hash', async () => {
    const raw = await tokens.issueRefreshToken(userId);
    expect(raw).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    const stored = await RefreshToken.find().lean();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.tokenHash).toBe(createHash('sha256').update(raw).digest('hex'));
    expect(JSON.stringify(stored)).not.toContain(raw);
  });

  it('rotate into a new token for the same user', async () => {
    const first = await tokens.issueRefreshToken(userId);
    const rotated = await tokens.rotateRefreshToken(first);
    expect(rotated.userId).toBe(userId);
    expect(rotated.refreshToken).not.toBe(first);
    await expect(tokens.rotateRefreshToken(rotated.refreshToken)).resolves.toMatchObject({ userId });
  });

  it('revoke the whole chain when an old token is reused', async () => {
    const first = await tokens.issueRefreshToken(userId);
    const second = (await tokens.rotateRefreshToken(first)).refreshToken;
    await expect(tokens.rotateRefreshToken(first)).rejects.toMatchObject(unauthenticated);
    await expect(tokens.rotateRefreshToken(second)).rejects.toMatchObject(unauthenticated);
  });

  it('expire after 30 days', async () => {
    const raw = await tokens.issueRefreshToken(userId);
    now = days(31);
    await expect(tokens.rotateRefreshToken(raw)).rejects.toMatchObject(unauthenticated);
  });

  it('get a MongoDB TTL expiry date 30 days out', async () => {
    await tokens.issueRefreshToken(userId);
    const [stored] = await RefreshToken.find().lean();
    expect(stored!.expiresAt.toISOString()).toBe(days(30).toISOString());
  });

  it('stop working once revoked; revoking an unknown token is a no-op', async () => {
    const raw = await tokens.issueRefreshToken(userId);
    await tokens.revokeRefreshToken(raw);
    await expect(tokens.rotateRefreshToken(raw)).rejects.toMatchObject(unauthenticated);
    await expect(tokens.revokeRefreshToken('unknown-token')).resolves.toBeUndefined();
  });

  it('reject unknown tokens', async () => {
    await expect(tokens.rotateRefreshToken('unknown-token')).rejects.toMatchObject(unauthenticated);
  });
});

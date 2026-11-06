import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { User } from '../../../src/models/user.model.js';
import { errorHandler } from '../../../src/middleware/error-handler.js';
import { createRequireAuth } from '../../../src/middleware/require-auth.js';
import { createTokenService } from '../../../src/modules/auth/tokens.js';
import { TEST_JWT_SECRET } from '../../helpers/app.js';
import { captureLogger } from '../../helpers/logger.js';
import { useTestDb } from '../../helpers/mongo.js';

useTestDb();

let now = new Date('2026-11-06T10:00:00Z');
const tokens = createTokenService({
  secret: TEST_JWT_SECRET,
  accessTtl: '15m',
  refreshTtlDays: 30,
  now: () => now,
});

const app = express();
app.get('/protected', createRequireAuth({ tokens }), (req, res) => {
  res.json({ userId: req.user!.id, email: req.user!.email });
});
app.use(errorHandler({ logger: captureLogger().logger, exposeStack: false }));

async function createUser() {
  return User.create({ email: 'ada@example.com', passwordHash: 'h', firstName: 'Ada', lastName: 'L' });
}

describe('requireAuth', () => {
  it('lets a valid token through and sets req.user', async () => {
    const user = await createUser();
    const token = await tokens.signAccessToken(user.id);
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: user.id, email: 'ada@example.com' });
  });

  it('accepts the scheme name in any case ("bearer")', async () => {
    const user = await createUser();
    const token = await tokens.signAccessToken(user.id);
    const res = await request(app).get('/protected').set('Authorization', `bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it.each([
    ['no header', undefined],
    ['wrong scheme', 'Basic abc'],
    ['empty bearer', 'Bearer '],
    ['garbage token', 'Bearer not-a-jwt'],
  ])('rejects %s with 401 UNAUTHENTICATED', async (_case, header) => {
    const req = request(app).get('/protected');
    const res = await (header ? req.set('Authorization', header) : req);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects an expired token', async () => {
    const user = await createUser();
    const token = await tokens.signAccessToken(user.id);
    now = new Date(now.getTime() + 16 * 60_000);
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    now = new Date('2026-11-06T10:00:00Z');
  });

  it('rejects a token for a user that no longer exists', async () => {
    const user = await createUser();
    const token = await tokens.signAccessToken(user.id);
    await User.deleteOne({ _id: user._id });
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});

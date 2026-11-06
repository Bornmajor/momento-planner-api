import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { User } from '../../../src/models/user.model.js';
import type { GoogleProfile } from '../../../src/modules/auth/google-verifier.js';
import { ADA, buildTestApp, registerUser } from '../../helpers/app.js';
import { useTestDb } from '../../helpers/mongo.js';

useTestDb();

const google: Record<string, GoogleProfile> = {
  'google-grace': {
    sub: 'g-grace',
    email: 'grace@example.com',
    emailVerified: true,
    givenName: 'Grace',
    familyName: 'Hopper',
  },
  'google-ada-verified': { sub: 'g-ada', email: 'ada@example.com', emailVerified: true, givenName: 'Ada' },
  'google-ada-unverified': { sub: 'g-ada-2', email: 'ada@example.com', emailVerified: false },
};
const { app } = buildTestApp({ google });
const api = '/api/v1/auth';

describe('POST /auth/register', () => {
  it('creates a user and returns tokens', async () => {
    const res = await registerUser(app, { email: 'Ada@Example.com' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      language: 'en',
      authProviders: ['password'],
    });
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('rejects an email that is already registered (any letter case)', async () => {
    await registerUser(app);
    const res = await registerUser(app, { email: 'ADA@example.com' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it.each([
    ['weak password', { password: 'password' }],
    ['invalid email', { email: 'not-an-email' }],
    ['empty first name', { firstName: '  ' }],
    ['last name over 50 chars', { lastName: 'x'.repeat(51) }],
  ])('rejects %s with 400', async (_case, overrides) => {
    const res = await registerUser(app, overrides);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /auth/login', () => {
  it('returns tokens for the correct password (email case-insensitive)', async () => {
    await registerUser(app);
    const res = await request(app)
      .post(`${api}/login`)
      .send({ email: 'ADA@example.com', password: ADA.password });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('ada@example.com');
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));
  });

  it('gives the same 401 for a wrong password, an unknown email and a Google-only account', async () => {
    await registerUser(app);
    await request(app).post(`${api}/google`).send({ idToken: 'google-grace' });

    const wrongPassword = await request(app)
      .post(`${api}/login`)
      .send({ email: ADA.email, password: 'Wr0ngpass' });
    const unknownEmail = await request(app)
      .post(`${api}/login`)
      .send({ email: 'nobody@example.com', password: ADA.password });
    const googleOnly = await request(app)
      .post(`${api}/login`)
      .send({ email: 'grace@example.com', password: ADA.password });

    for (const res of [wrongPassword, unknownEmail, googleOnly]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual(wrongPassword.body);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    }
  });
});

describe('POST /auth/refresh and /auth/logout', () => {
  it('rotates the refresh token; reusing the old one revokes the chain', async () => {
    const { refreshToken } = (await registerUser(app)).body;

    const rotated = await request(app).post(`${api}/refresh`).send({ refreshToken });
    expect(rotated.status).toBe(200);
    expect(rotated.body.accessToken).toEqual(expect.any(String));
    expect(rotated.body.refreshToken).not.toBe(refreshToken);

    const reused = await request(app).post(`${api}/refresh`).send({ refreshToken });
    expect(reused.status).toBe(401);
    const newest = await request(app)
      .post(`${api}/refresh`)
      .send({ refreshToken: rotated.body.refreshToken });
    expect(newest.status).toBe(401);
  });

  it('rejects an unknown refresh token with 401', async () => {
    const res = await request(app).post(`${api}/refresh`).send({ refreshToken: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('logout returns 204 and the refresh token stops working', async () => {
    const { refreshToken } = (await registerUser(app)).body;
    expect((await request(app).post(`${api}/logout`).send({ refreshToken })).status).toBe(204);
    expect((await request(app).post(`${api}/refresh`).send({ refreshToken })).status).toBe(401);
  });

  it('logout with an invalid token still returns 204', async () => {
    expect((await request(app).post(`${api}/logout`).send({ refreshToken: 'nope' })).status).toBe(204);
  });
});

describe('POST /auth/google', () => {
  it('creates a new user from the Google profile', async () => {
    const res = await request(app).post(`${api}/google`).send({ idToken: 'google-grace' });
    expect(res.status).toBe(200);
    expect(res.body.isNewUser).toBe(true);
    expect(res.body.user).toMatchObject({
      email: 'grace@example.com',
      firstName: 'Grace',
      lastName: 'Hopper',
      authProviders: ['google'],
    });
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));
  });

  it('signs in the same user next time', async () => {
    const first = await request(app).post(`${api}/google`).send({ idToken: 'google-grace' });
    const second = await request(app).post(`${api}/google`).send({ idToken: 'google-grace' });
    expect(second.body.isNewUser).toBe(false);
    expect(second.body.user.id).toBe(first.body.user.id);
  });

  it('links Google to an existing password account when Google verified the email', async () => {
    const registered = await registerUser(app);
    const res = await request(app).post(`${api}/google`).send({ idToken: 'google-ada-verified' });
    expect(res.status).toBe(200);
    expect(res.body.isNewUser).toBe(false);
    expect(res.body.user.id).toBe(registered.body.user.id);
    expect(res.body.user.authProviders).toEqual(['password', 'google']);
    // The password still works after linking.
    const login = await request(app).post(`${api}/login`).send({ email: ADA.email, password: ADA.password });
    expect(login.status).toBe(200);
  });

  it('does not link when Google has not verified the email', async () => {
    await registerUser(app);
    const res = await request(app).post(`${api}/google`).send({ idToken: 'google-ada-unverified' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
    expect((await User.findOne({ email: ADA.email }))!.googleId).toBeUndefined();
  });

  it('rejects an invalid Google token with 401 and a missing one with 400', async () => {
    expect((await request(app).post(`${api}/google`).send({ idToken: 'forged' })).status).toBe(401);
    expect((await request(app).post(`${api}/google`).send({})).status).toBe(400);
  });
});

describe('auth rate limits', () => {
  it('returns 429 RATE_LIMITED on the 11th login attempt within 15 minutes', async () => {
    const { app: limited } = buildTestApp({ rateLimits: { auth: 10, refresh: 30 } });
    for (let i = 0; i < 10; i += 1) {
      const res = await request(limited)
        .post(`${api}/login`)
        .send({ email: ADA.email, password: 'Wr0ngpass' });
      expect(res.status).toBe(401);
    }
    const blocked = await request(limited)
      .post(`${api}/login`)
      .send({ email: ADA.email, password: 'Wr0ngpass' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });
});

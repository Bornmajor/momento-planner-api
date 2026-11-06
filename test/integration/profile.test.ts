import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, registerUser } from '../helpers/app.js';
import { useTestDb } from '../helpers/mongo.js';

useTestDb();

const { app } = buildTestApp();
let auth: string;

beforeEach(async () => {
  const res = await registerUser(app);
  auth = `Bearer ${res.body.accessToken}`;
});

const patch = (body: object) => request(app).patch('/api/v1/me').set('Authorization', auth).send(body);

describe('GET /me', () => {
  it('requires authentication', async () => {
    expect((await request(app).get('/api/v1/me')).status).toBe(401);
    expect((await request(app).patch('/api/v1/me').send({ firstName: 'X' })).status).toBe(401);
  });

  it('returns the public user', async () => {
    const res = await request(app).get('/api/v1/me').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      email: 'ada@example.com',
      firstName: 'Ada',
      phone: null,
      language: 'en',
    });
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });
});

describe('PATCH /me', () => {
  it('updates names and language (names trimmed), and the change persists', async () => {
    const res = await patch({ firstName: '  Augusta ', lastName: 'King', language: 'sw' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ firstName: 'Augusta', lastName: 'King', language: 'sw' });
    const again = await request(app).get('/api/v1/me').set('Authorization', auth);
    expect(again.body.user).toMatchObject({ firstName: 'Augusta', lastName: 'King', language: 'sw' });
  });

  it('normalizes the phone number to E.164, and null clears it', async () => {
    expect((await patch({ phone: '+254 712 345 678' })).body.user.phone).toBe('+254712345678');
    expect((await patch({ phone: null })).body.user.phone).toBeNull();
  });

  it.each([
    ['invalid phone number', { phone: '+1 23' }],
    ['phone without a country code', { phone: '0712345678' }],
    ['unsupported language', { language: 'de' }],
    ['empty first name', { firstName: '' }],
    ['last name over 50 chars', { lastName: 'x'.repeat(51) }],
  ])('rejects %s with 400', async (_case, body) => {
    const res = await patch(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('ignores fields that cannot be changed (email, passwordHash, googleId)', async () => {
    const res = await patch({
      email: 'evil@example.com',
      passwordHash: 'x',
      googleId: 'g',
      firstName: 'Ada2',
    });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      email: 'ada@example.com',
      firstName: 'Ada2',
      authProviders: ['password'],
    });
  });

  it('treats an empty body as no change', async () => {
    const res = await patch({});
    expect(res.status).toBe(200);
    expect(res.body.user.firstName).toBe('Ada');
  });
});

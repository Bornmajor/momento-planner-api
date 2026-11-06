import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { RefreshToken } from '../../src/models/refresh-token.model.js';
import { SavedEvent } from '../../src/models/saved-event.model.js';
import { User } from '../../src/models/user.model.js';
import { buildTestApp, registerUser } from '../helpers/app.js';
import { fakeEventProvider, sampleEvent } from '../helpers/events.js';
import { useTestDb } from '../helpers/mongo.js';

useTestDb();

const { app } = buildTestApp({ eventProvider: fakeEventProvider([sampleEvent({ id: 'jazz-1' })]) });

describe('DELETE /me', () => {
  it('requires authentication', async () => {
    expect((await request(app).delete('/api/v1/me')).status).toBe(401);
  });

  it('deletes the account and everything tied to it; the email can be used again', async () => {
    const { accessToken, refreshToken } = (await registerUser(app)).body;
    const auth = `Bearer ${accessToken}`;
    await request(app).post('/api/v1/me/saved-events').set('Authorization', auth).send({ eventId: 'jazz-1' });

    expect((await request(app).delete('/api/v1/me').set('Authorization', auth)).status).toBe(204);

    expect(await User.countDocuments()).toBe(0);
    expect(await RefreshToken.countDocuments()).toBe(0);
    expect(await SavedEvent.countDocuments()).toBe(0);
    expect((await request(app).get('/api/v1/me').set('Authorization', auth)).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/refresh').send({ refreshToken })).status).toBe(401);
    expect((await registerUser(app)).status).toBe(201);
  });
});

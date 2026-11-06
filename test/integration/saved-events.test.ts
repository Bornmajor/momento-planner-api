import mongoose from 'mongoose';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { SavedEvent } from '../../src/models/saved-event.model.js';
import { buildTestApp, registerUser } from '../helpers/app.js';
import { fakeEventProvider, sampleEvent } from '../helpers/events.js';
import { useTestDb } from '../helpers/mongo.js';

useTestDb();

const { app } = buildTestApp({
  eventProvider: fakeEventProvider([sampleEvent({ id: 'jazz-1' }), sampleEvent({ id: 'film-1' })]),
});
const path = '/api/v1/me/saved-events';
let auth: string;
let userId: string;

beforeEach(async () => {
  const res = await registerUser(app);
  auth = `Bearer ${res.body.accessToken}`;
  userId = res.body.user.id;
});

describe('saved events', () => {
  it('saves an event once (201, then 200), lists it with details, and deletes it', async () => {
    const first = await request(app).post(path).set('Authorization', auth).send({ eventId: 'jazz-1' });
    expect(first.status).toBe(201);
    expect(first.body.savedEvent).toMatchObject({ eventId: 'jazz-1', savedAt: expect.any(String) });
    expect(
      (await request(app).post(path).set('Authorization', auth).send({ eventId: 'jazz-1' })).status,
    ).toBe(200);

    const list = await request(app).get(path).set('Authorization', auth);
    expect(list.body).toMatchObject({ totalItems: 1, page: 0, size: 20 });
    expect(list.body.items[0]).toMatchObject({ eventId: 'jazz-1', available: true, event: { id: 'jazz-1' } });

    expect((await request(app).delete(`${path}/jazz-1`).set('Authorization', auth)).status).toBe(204);
    expect((await request(app).get(path).set('Authorization', auth)).body.totalItems).toBe(0);
  });

  it('marks events the source no longer has as unavailable', async () => {
    await SavedEvent.create({ userId, source: 'ticketmaster', eventId: 'gone-1' });
    const list = await request(app).get(path).set('Authorization', auth);
    expect(list.body.items[0]).toEqual(
      expect.objectContaining({ eventId: 'gone-1', available: false, event: null }),
    );
  });

  it('rejects unknown events (404) and the 101st save (409)', async () => {
    expect((await request(app).post(path).set('Authorization', auth).send({ eventId: 'nope' })).status).toBe(
      404,
    );

    await SavedEvent.insertMany(
      Array.from({ length: 100 }, (_, i) => ({
        userId: new mongoose.Types.ObjectId(userId),
        source: 'ticketmaster',
        eventId: `old-${i}`,
      })),
    );
    const res = await request(app).post(path).set('Authorization', auth).send({ eventId: 'film-1' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SAVED_LIMIT_REACHED');
  });
});

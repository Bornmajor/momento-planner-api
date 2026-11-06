import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, registerUser } from '../helpers/app.js';
import { fakeEventProvider, sampleEvent } from '../helpers/events.js';
import { useTestDb } from '../helpers/mongo.js';

useTestDb();

const events = [
  sampleEvent({ id: 'jazz-1', title: 'Jazz Night' }),
  sampleEvent({ id: 'match-1', title: 'Cup Final', category: { id: 'sports', name: 'Sports' } }),
];
const { app } = buildTestApp({ eventProvider: fakeEventProvider(events) });
let auth: string;

// The database is cleared after every test, so each test signs up again.
beforeEach(async () => {
  auth = `Bearer ${(await registerUser(app)).body.accessToken}`;
});

describe('events API', () => {
  it('requires authentication', async () => {
    expect((await request(app).get('/api/v1/events')).status).toBe(401);
  });

  it('searches with keyword and category, returning a page', async () => {
    const res = await request(app).get('/api/v1/events?q=cup&category=sports').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 0, size: 20, totalItems: 1 });
    expect(res.body.items.map((e: { id: string }) => e.id)).toEqual(['match-1']);
  });

  it('rejects an unknown category, oversized pages and paging past item 1000', async () => {
    for (const query of ['category=opera', 'size=51', 'page=50&size=20']) {
      const res = await request(app).get(`/api/v1/events?${query}`).set('Authorization', auth);
      expect(res.status, query).toBe(400);
    }
  });

  it('lists the five categories', async () => {
    const res = await request(app).get('/api/v1/events/categories').set('Authorization', auth);
    expect(res.body.items.map((c: { id: string }) => c.id)).toEqual([
      'music',
      'sports',
      'arts-theatre',
      'film',
      'miscellaneous',
    ]);
  });

  it('returns event details, or 404 for an unknown id', async () => {
    const found = await request(app).get('/api/v1/events/jazz-1').set('Authorization', auth);
    expect(found.body.event).toMatchObject({ id: 'jazz-1', description: expect.any(String) });
    const missing = await request(app).get('/api/v1/events/nope').set('Authorization', auth);
    expect(missing.status).toBe(404);
  });
});

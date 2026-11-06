import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createFakeAiProvider } from '../../src/providers/ai/fake-ai.provider.js';
import { buildTestApp, registerUser } from '../helpers/app.js';
import { fakeEventProvider, sampleEvent } from '../helpers/events.js';
import { useTestDb } from '../helpers/mongo.js';

useTestDb();

const ai = createFakeAiProvider();
const event = sampleEvent({ id: 'jazz-1' });
const { app } = buildTestApp({ eventProvider: fakeEventProvider([event]), aiProvider: ai, aiDailyLimit: 2 });
let auth: string;

beforeEach(async () => {
  auth = `Bearer ${(await registerUser(app)).body.accessToken}`;
  ai.calls.length = 0;
});

const personalize = (id: string, body: object) =>
  request(app).post(`/api/v1/events/${id}/personalize`).set('Authorization', auth).send(body);

describe('POST /events/:id/personalize', () => {
  it('requires at least one option', async () => {
    const res = await personalize('jazz-1', { shorten: false });
    expect(res.status).toBe(400);
  });

  it('returns the original text without calling the AI when only translating to English', async () => {
    const res = await personalize('jazz-1', { shorten: false, translateTo: 'en' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: event.title, description: event.description, cached: false });
    expect(ai.calls).toHaveLength(0);
  });

  it('calls the AI once, then serves the same request from the cache', async () => {
    const first = await personalize('jazz-1', { shorten: true, translateTo: 'sw' });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      cached: false,
      title: expect.any(String),
      description: expect.any(String),
    });
    expect(first.body.facts).toEqual({
      dateTimeText: expect.any(String),
      venueText: "Ronnie Scott's, London, Great Britain",
      url: event.url,
    });

    const second = await personalize('jazz-1', { shorten: true, translateTo: 'sw' });
    expect(second.body).toMatchObject({ cached: true, title: first.body.title });
    expect(ai.calls).toHaveLength(1);
    expect(ai.calls[0]).toMatchObject({ shorten: true, translateTo: 'sw' });
  });

  it('enforces the daily AI limit on uncached requests', async () => {
    expect((await personalize('jazz-1', { shorten: true })).status).toBe(200);
    expect((await personalize('jazz-1', { translateTo: 'fr' })).status).toBe(200);
    const res = await personalize('jazz-1', { shorten: true, translateTo: 'fr' });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('AI_LIMIT_REACHED');
  });

  it('returns 404 for an unknown event', async () => {
    expect((await personalize('nope', { shorten: true })).status).toBe(404);
  });
});

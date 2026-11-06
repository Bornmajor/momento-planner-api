import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { captureLogger } from '../helpers/logger.js';

function build(isDbUp = true) {
  const log = captureLogger();
  return { app: createApp({ logger: log.logger, isDbUp: () => isDbUp }), log };
}

describe('app shell', () => {
  it('GET /health reports ok with the database up', async () => {
    const res = await request(build(true).app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'up' });
  });

  it('GET /health reports the database down', async () => {
    const res = await request(build(false).app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'down' });
  });

  it('returns the standard 404 shape for unknown API routes', async () => {
    const res = await request(build().app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 VALIDATION_ERROR for malformed JSON', async () => {
    const res = await request(build().app)
      .post('/api/v1/anything')
      .set('Content-Type', 'application/json')
      .send('{"broken":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 413 PAYLOAD_TOO_LARGE for bodies over 100 KB', async () => {
    const res = await request(build().app)
      .post('/api/v1/anything')
      .send({ data: 'a'.repeat(110 * 1024) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('sets security headers and hides X-Powered-By', async () => {
    const res = await request(build().app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('logs requests without the Authorization header value', async () => {
    const { app, log } = build();
    await request(app).get('/health').set('Authorization', 'Bearer super-secret-token');
    expect(log.lines.length).toBeGreaterThan(0);
    expect(log.text()).not.toContain('super-secret-token');
  });
});

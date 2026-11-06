import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/lib/errors.js';
import { errorHandler } from '../../../src/middleware/error-handler.js';
import { notFound } from '../../../src/middleware/not-found.js';
import { captureLogger } from '../../helpers/logger.js';

function buildApp(exposeStack = false) {
  const log = captureLogger();
  const app = express();
  app.get('/app-error', () => {
    throw new AppError('EMAIL_TAKEN', 'Email already registered', [{ field: 'email' }]);
  });
  app.get('/crash', () => {
    throw new Error('db password leaked in message');
  });
  app.get('/async-crash', async () => {
    await Promise.resolve();
    throw new Error('async failure');
  });
  app.use(notFound);
  app.use(errorHandler({ logger: log.logger, exposeStack }));
  return { app, log };
}

describe('errorHandler + notFound', () => {
  it('returns an AppError as its status and code', async () => {
    const res = await request(buildApp().app).get('/app-error');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: { code: 'EMAIL_TAKEN', message: 'Email already registered', details: [{ field: 'email' }] },
    });
  });

  it('returns 404 NOT_FOUND for unknown routes', async () => {
    const res = await request(buildApp().app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toMatch(/not found/i);
  });

  it('hides unexpected errors behind 500 INTERNAL', async () => {
    const res = await request(buildApp().app).get('/crash');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL');
    expect(JSON.stringify(res.body)).not.toContain('db password');
    expect(res.body.error.stack).toBeUndefined();
  });

  it('handles errors thrown from async handlers', async () => {
    const res = await request(buildApp().app).get('/async-crash');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL');
  });

  it('includes the stack only when exposeStack is on (development)', async () => {
    const res = await request(buildApp(true).app).get('/crash');
    expect(res.body.error.stack).toEqual(expect.any(String));
  });

  it('logs unexpected errors server-side at error level', async () => {
    const { app, log } = buildApp();
    await request(app).get('/crash');
    const errorLine = log.lines.map((l) => JSON.parse(l)).find((l) => l.level === 50);
    expect(errorLine).toBeDefined();
    expect(JSON.stringify(errorLine)).toContain('db password leaked');
  });
});

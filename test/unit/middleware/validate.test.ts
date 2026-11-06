import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { errorHandler } from '../../../src/middleware/error-handler.js';
import { validate } from '../../../src/middleware/validate.js';
import { captureLogger } from '../../helpers/logger.js';

const app = express();
app.use(express.json());
app.post(
  '/items/:id',
  validate({
    params: z.object({ id: z.string().regex(/^[a-f0-9]{4}$/) }),
    query: z.object({ page: z.coerce.number().int().min(0).default(0) }),
    body: z.object({ name: z.string().min(1), qty: z.number().int().positive() }),
  }),
  (req, res) => {
    res.json(req.valid);
  },
);
app.use(errorHandler({ logger: captureLogger().logger, exposeStack: false }));

describe('validate middleware', () => {
  it('passes parsed values to the handler (query numbers converted)', async () => {
    const res = await request(app).post('/items/ab12?page=2').send({ name: 'Ticket', qty: 2 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      params: { id: 'ab12' },
      query: { page: 2 },
      body: { name: 'Ticket', qty: 2 },
    });
  });

  it('applies schema defaults', async () => {
    const res = await request(app).post('/items/ab12').send({ name: 'Ticket', qty: 1 });
    expect(res.body.query).toEqual({ page: 0 });
  });

  it('removes unknown fields', async () => {
    const res = await request(app).post('/items/ab12').send({ name: 'Ticket', qty: 1, isAdmin: true });
    expect(res.body.body).toEqual({ name: 'Ticket', qty: 1 });
  });

  it('rejects invalid input with 400 VALIDATION_ERROR and field details', async () => {
    const res = await request(app).post('/items/ab12').send({ name: 'Ticket', qty: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toContainEqual(
      expect.objectContaining({ location: 'body', path: 'qty', message: expect.any(String) }),
    );
  });

  it('reports problems from several locations together', async () => {
    const res = await request(app).post('/items/NOPE').send({ qty: 1 });
    expect(res.status).toBe(400);
    const locations = res.body.error.details.map((d: { location: string }) => d.location);
    expect(locations).toEqual(expect.arrayContaining(['params', 'body']));
  });
});

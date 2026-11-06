import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { connectDb, disconnectDb, isDbConnected } from '../../src/lib/db.js';
import { captureLogger } from '../helpers/logger.js';
import { testDbUri } from '../helpers/mongo.js';

// These tests run in order: connect, use, then disconnect.
describe('database connection', () => {
  afterAll(async () => {
    await disconnectDb();
  });

  it('connects and reports connected', async () => {
    expect(isDbConnected()).toBe(false);
    await connectDb(testDbUri());
    expect(isDbConnected()).toBe(true);
  });

  it('round-trips a document', async () => {
    const Probe = mongoose.model('Probe', new mongoose.Schema({ name: String }));
    await Probe.create({ name: 'hello' });
    expect(await Probe.findOne({ name: 'hello' }).lean()).toMatchObject({ name: 'hello' });
  });

  it('blocks $ operators smuggled in as values (sanitizeFilter)', async () => {
    const Probe = mongoose.model('Probe');
    // Unsanitized, { $ne: 'nobody' } would match the 'hello' document. sanitizeFilter wraps it in $eq,
    // and Mongoose 9 then refuses to cast that object to a string, so the query is rejected outright.
    const userInput = { $ne: 'nobody' } as unknown as string;
    await expect(Probe.findOne({ name: userInput })).rejects.toMatchObject({ name: 'CastError' });
  });

  it('GET /health uses the real connection state by default', async () => {
    const app = createApp({ logger: captureLogger().logger });
    expect((await request(app).get('/health')).body.db).toBe('up');
  });

  it('reports disconnected after disconnectDb, and /health shows down', async () => {
    await mongoose.connection.dropDatabase();
    await disconnectDb();
    expect(isDbConnected()).toBe(false);
    const app = createApp({ logger: captureLogger().logger });
    expect((await request(app).get('/health')).body.db).toBe('down');
  });
});

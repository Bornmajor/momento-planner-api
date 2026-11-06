import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, inject } from 'vitest';
import { connectDb, disconnectDb } from '../../src/lib/db.js';

/** A connection URI for a fresh database on the shared in-memory server (see test/global-setup.ts). */
export function testDbUri(): string {
  const base = inject('mongoUri').replace(/\/?$/, '/');
  return `${base}test-${randomUUID().slice(0, 8)}`;
}

/** Deletes every document in every collection, keeping indexes. */
export async function clearDb(): Promise<void> {
  const collections = Object.values(mongoose.connection.collections);
  await Promise.all(collections.map((c) => c.deleteMany({})));
}

/**
 * Connects this test file to its own database, builds model indexes (so unique constraints are
 * enforced), clears data after each test, and drops the database at the end.
 */
export function useTestDb(): void {
  beforeAll(async () => {
    await connectDb(testDbUri());
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  });
  afterEach(clearDb);
  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await disconnectDb();
  });
}

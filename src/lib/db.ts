import mongoose from 'mongoose';

/** Rejects query filters containing `$` operators that came from user input (spec §10). */
mongoose.set('sanitizeFilter', true);

export async function connectDb(uri: string): Promise<void> {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}

export function isDbConnected(): boolean {
  return mongoose.connection.readyState === mongoose.ConnectionStates.connected;
}

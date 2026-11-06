import { MongoMemoryServer } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';

/** Starts one in-memory MongoDB for the whole test run. Each test file uses its own database on it. */
export default async function setup(project: TestProject) {
  const server = await MongoMemoryServer.create();
  project.provide('mongoUri', server.getUri());
  return async () => {
    await server.stop();
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
  }
}

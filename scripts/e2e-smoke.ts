/**
 * T7.2 end-to-end smoke test: the real app over HTTP, with the real Ticketmaster and Claude APIs.
 *
 *   npx tsx --env-file=.env scripts/e2e-smoke.ts           # in-memory MongoDB
 *   npx tsx --env-file=.env scripts/e2e-smoke.ts --atlas   # your MONGODB_URI, in a throwaway
 *                                                          # "momento-smoke" database, dropped at the end
 *
 * Costs: ~10 Ticketmaster calls and one Claude Haiku call (well under one cent).
 */
import type { AddressInfo } from 'node:net';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { EVENT_COUNTRIES } from '../src/config/constants.js';
import { loadEnv } from '../src/config/env.js';
import { createServices } from '../src/container.js';
import { connectDb, disconnectDb } from '../src/lib/db.js';
import { createLogger } from '../src/lib/logger.js';
import { createGoogleVerifier } from '../src/modules/auth/google-verifier.js';
import { createClaudeProvider } from '../src/providers/ai/claude.provider.js';
import { createFakeAiProvider } from '../src/providers/ai/fake-ai.provider.js';
import { createTicketmasterProvider } from '../src/providers/events/ticketmaster.provider.js';

const useAtlas = process.argv.includes('--atlas');
let memory: MongoMemoryServer | undefined;

function smokeDbUri(uri: string): string {
  const url = new URL(uri);
  url.pathname = '/momento-smoke';
  return url.toString();
}

if (useAtlas) {
  if (!process.env.MONGODB_URI) throw new Error('--atlas needs MONGODB_URI in .env');
  process.env.MONGODB_URI = smokeDbUri(process.env.MONGODB_URI);
} else {
  memory = await MongoMemoryServer.create();
  process.env.MONGODB_URI = memory.getUri('momento-smoke');
}

const env = loadEnv(process.env);
await connectDb(env.mongodbUri);

const services = createServices({
  jwtAccessSecret: env.jwtAccessSecret,
  accessTokenTtl: env.accessTokenTtl,
  refreshTokenTtlDays: env.refreshTokenTtlDays,
  googleVerifier: createGoogleVerifier(env.googleClientIds),
  eventProvider: createTicketmasterProvider({ apiKey: env.ticketmasterApiKey, countries: EVENT_COUNTRIES }),
  aiProvider: env.anthropicApiKey
    ? createClaudeProvider({ apiKey: env.anthropicApiKey, model: env.aiModel })
    : createFakeAiProvider(),
  aiDailyLimitPerUser: env.aiDailyLimitPerUser,
});
const app = createApp({ logger: createLogger({ level: 'silent' }), services });
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

let failures = 0;
async function step<T>(name: string, run: () => Promise<T>): Promise<T | undefined> {
  try {
    const result = await run();
    console.log(`  ✓ ${name}`);
    return result;
  } catch (err) {
    failures += 1;
    console.log(`  ✗ ${name}: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token && { authorization: `Bearer ${token}` }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function expectStatus(res: { status: number; body: unknown }, status: number) {
  if (res.status !== status)
    throw new Error(`expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`);
}

const aiLabel = env.anthropicApiKey ? env.aiModel : 'fake AI (no ANTHROPIC_API_KEY)';
console.log(`\nMomento API smoke test (${useAtlas ? 'Atlas' : 'in-memory MongoDB'}, AI: ${aiLabel})\n`);

await step('GET /health reports the database up', async () => {
  const body = (await (await fetch(`${base}/health`)).json()) as { db?: string };
  if (body.db !== 'up') throw new Error(JSON.stringify(body));
});

const email = `smoke-${Date.now()}@example.com`;
const session = await step('register a new user', async () => {
  const res = await call('POST', '/auth/register', {
    email,
    password: 'Smoke-test-1',
    firstName: 'Smoke',
    lastName: 'Test',
  });
  expectStatus(res, 201);
  return res.body as { accessToken: string; refreshToken: string };
});
const token = session?.accessToken;

await step('update the profile (language sw, phone)', async () => {
  const res = await call('PATCH', '/me', { language: 'sw', phone: '+254 712 345 678' }, token);
  expectStatus(res, 200);
  if (res.body.user.phone !== '+254712345678') throw new Error(`phone ${res.body.user.phone}`);
});

const event = await step('search music events and open one with a description', async () => {
  const res = await call('GET', '/events?category=music&size=20', undefined, token);
  expectStatus(res, 200);
  for (const summary of res.body.items as { id: string }[]) {
    const details = await call('GET', `/events/${summary.id}`, undefined, token);
    if (details.body.event?.description) return details.body.event as { id: string; title: string };
  }
  throw new Error('no event with a description in the first 20 results');
});

if (event) {
  console.log(`      event: ${event.title}`);
  await step('personalize: shorten + Swahili (real AI call)', async () => {
    const res = await call(
      'POST',
      `/events/${event.id}/personalize`,
      { shorten: true, translateTo: 'sw' },
      token,
    );
    expectStatus(res, 200);
    if (res.body.cached) throw new Error('expected a fresh AI result');
    console.log(`      title: ${res.body.title}`);
    console.log(`      description: ${res.body.description}`);
    console.log(`      when: ${res.body.facts.dateTimeText} · where: ${res.body.facts.venueText}`);
  });

  await step('personalize again is served from the cache', async () => {
    const res = await call(
      'POST',
      `/events/${event.id}/personalize`,
      { shorten: true, translateTo: 'sw' },
      token,
    );
    expectStatus(res, 200);
    if (!res.body.cached) throw new Error('expected cached: true');
  });

  await step('save the event, then see it in My Events', async () => {
    expectStatus(await call('POST', '/me/saved-events', { eventId: event.id }, token), 201);
    const list = await call('GET', '/me/saved-events', undefined, token);
    expectStatus(list, 200);
    if (list.body.items[0]?.event?.id !== event.id || !list.body.items[0].available) {
      throw new Error(JSON.stringify(list.body.items[0]));
    }
  });
}

await step('refresh rotates tokens; logout revokes them', async () => {
  const refreshed = await call('POST', '/auth/refresh', { refreshToken: session?.refreshToken });
  expectStatus(refreshed, 200);
  expectStatus(await call('POST', '/auth/logout', { refreshToken: refreshed.body.refreshToken }), 204);
  expectStatus(await call('POST', '/auth/refresh', { refreshToken: refreshed.body.refreshToken }), 401);
});

server.close();
await mongoose.connection.dropDatabase();
await disconnectDb();
await memory?.stop();

console.log(failures === 0 ? '\nAll smoke checks passed.\n' : `\n${failures} smoke check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);

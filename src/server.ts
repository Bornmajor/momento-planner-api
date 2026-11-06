import { createApp } from './app.js';
import { EnvError, loadEnv } from './config/env.js';
import { createServices } from './container.js';
import { connectDb, disconnectDb } from './lib/db.js';
import { createLogger } from './lib/logger.js';
import { createGoogleVerifier } from './modules/auth/google-verifier.js';
import { EVENT_COUNTRIES } from './config/constants.js';
import { createClaudeProvider } from './providers/ai/claude.provider.js';
import { createFakeAiProvider } from './providers/ai/fake-ai.provider.js';
import { createTicketmasterProvider } from './providers/events/ticketmaster.provider.js';

function readEnv() {
  try {
    return loadEnv(process.env);
  } catch (err) {
    if (err instanceof EnvError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}

const env = readEnv();
const logger = createLogger({ level: env.nodeEnv === 'production' ? 'info' : 'debug' });

try {
  await connectDb(env.mongodbUri);
  logger.info('Connected to MongoDB');
} catch (err) {
  logger.fatal({ err }, 'Could not connect to MongoDB (check MONGODB_URI and the Atlas IP allowlist)');
  process.exit(1);
}

if (env.googleClientIds.length === 0) logger.warn('GOOGLE_CLIENT_IDS is empty: Google sign-in is disabled');
if (!env.anthropicApiKey) logger.warn('ANTHROPIC_API_KEY is empty: using the fake AI provider');

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
const app = createApp({ logger, services, exposeStack: env.nodeEnv === 'development' });
const server = app.listen(env.port, () => logger.info(`API listening on http://localhost:${env.port}`));

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  // Stop accepting connections and let in-flight requests finish before closing the database.
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await disconnectDb();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

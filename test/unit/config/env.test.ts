import { describe, expect, it } from 'vitest';
import { EnvError, loadEnv } from '../../../src/config/env.js';

const SECRET = 'x'.repeat(32);
const base = {
  MONGODB_URI: 'mongodb://localhost:27017/momento',
  JWT_ACCESS_SECRET: SECRET,
  TICKETMASTER_API_KEY: 'tm-key',
};

function errorMessage(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(EnvError);
    return (err as Error).message;
  }
  throw new Error('expected loadEnv to throw');
}

describe('loadEnv', () => {
  it('applies defaults for optional settings', () => {
    const env = loadEnv(base);
    expect(env).toMatchObject({
      nodeEnv: 'development',
      port: 4000,
      mongodbUri: base.MONGODB_URI,
      jwtAccessSecret: SECRET,
      accessTokenTtl: '15m',
      refreshTokenTtlDays: 30,
      googleClientIds: [],
      ticketmasterApiKey: 'tm-key',
      aiModel: 'claude-haiku-5-5',
      aiDailyLimitPerUser: 20,
      corsOrigins: [],
    });
    expect(env.anthropicApiKey).toBeUndefined();
  });

  it('reads provided values and converts numbers', () => {
    const env = loadEnv({
      ...base,
      NODE_ENV: 'production',
      PORT: '5000',
      REFRESH_TOKEN_TTL_DAYS: '7',
      AI_DAILY_LIMIT_PER_USER: '5',
      ANTHROPIC_API_KEY: 'sk-test',
      AI_MODEL: 'claude-opus-5-5',
    });
    expect(env).toMatchObject({
      nodeEnv: 'production',
      port: 5000,
      refreshTokenTtlDays: 7,
      aiDailyLimitPerUser: 5,
      anthropicApiKey: 'sk-test',
      aiModel: 'claude-opus-5-5',
    });
  });

  it('reports every missing required variable at once', () => {
    const message = errorMessage(() => loadEnv({}));
    expect(message).toContain('MONGODB_URI');
    expect(message).toContain('JWT_ACCESS_SECRET');
    expect(message).toContain('TICKETMASTER_API_KEY');
  });

  it('rejects a JWT secret shorter than 32 bytes without echoing it', () => {
    const message = errorMessage(() => loadEnv({ ...base, JWT_ACCESS_SECRET: 'short-secret-value' }));
    expect(message).toContain('JWT_ACCESS_SECRET');
    expect(message).not.toContain('short-secret-value');
  });

  it('rejects a MONGODB_URI that is not a MongoDB URL', () => {
    expect(errorMessage(() => loadEnv({ ...base, MONGODB_URI: 'http://example.com' }))).toContain(
      'MONGODB_URI',
    );
    expect(() =>
      loadEnv({ ...base, MONGODB_URI: 'mongodb+srv://u:p@cluster.mongodb.net/momento' }),
    ).not.toThrow();
  });

  it.each(['abc', '0', '70000'])('rejects PORT=%s', (port) => {
    expect(errorMessage(() => loadEnv({ ...base, PORT: port }))).toContain('PORT');
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(errorMessage(() => loadEnv({ ...base, NODE_ENV: 'staging' }))).toContain('NODE_ENV');
  });

  it('treats an empty ANTHROPIC_API_KEY as not set', () => {
    expect(loadEnv({ ...base, ANTHROPIC_API_KEY: '' }).anthropicApiKey).toBeUndefined();
  });

  it('splits comma-separated lists and drops blanks', () => {
    const env = loadEnv({
      ...base,
      GOOGLE_CLIENT_IDS: ' a.apps.googleusercontent.com , b.apps.googleusercontent.com ,, ',
      CORS_ORIGINS: 'http://localhost:8081',
    });
    expect(env.googleClientIds).toEqual(['a.apps.googleusercontent.com', 'b.apps.googleusercontent.com']);
    expect(env.corsOrigins).toEqual(['http://localhost:8081']);
  });

  it('returns a frozen object', () => {
    expect(Object.isFrozen(loadEnv(base))).toBe(true);
  });
});

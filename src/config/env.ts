import { z } from 'zod';

const list = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  MONGODB_URI: z.string().regex(/^mongodb(\+srv)?:\/\//, 'must be a mongodb:// or mongodb+srv:// URL'),
  JWT_ACCESS_SECRET: z
    .string()
    .refine((secret) => Buffer.byteLength(secret) >= 32, 'must be at least 32 bytes long'),
  ACCESS_TOKEN_TTL: z
    .string()
    .regex(/^\d+[smhd]$/, 'must look like 15m, 1h or 30s')
    .default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  GOOGLE_CLIENT_IDS: list,
  TICKETMASTER_API_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().min(1).default('claude-haiku-5-5'),
  AI_DAILY_LIMIT_PER_USER: z.coerce.number().int().min(0).default(20),
  CORS_ORIGINS: list,
});

export interface Env {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  mongodbUri: string;
  jwtAccessSecret: string;
  accessTokenTtl: string;
  refreshTokenTtlDays: number;
  googleClientIds: string[];
  ticketmasterApiKey: string;
  anthropicApiKey: string | undefined;
  aiModel: string;
  aiDailyLimitPerUser: number;
  corsOrigins: string[];
}

export class EnvError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid environment configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'EnvError';
  }
}

/**
 * Validates and converts environment variables. Empty values count as "not set", so a blank line
 * in .env falls back to the default (or fails if the variable is required).
 * Error messages name the variable but never echo its value, so secrets can't leak into logs.
 */
export function loadEnv(source: Record<string, string | undefined>): Readonly<Env> {
  const cleaned = Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key, value === '' ? undefined : value]),
  );
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    throw new EnvError(result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`));
  }
  const e = result.data;
  return Object.freeze({
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    mongodbUri: e.MONGODB_URI,
    jwtAccessSecret: e.JWT_ACCESS_SECRET,
    accessTokenTtl: e.ACCESS_TOKEN_TTL,
    refreshTokenTtlDays: e.REFRESH_TOKEN_TTL_DAYS,
    googleClientIds: e.GOOGLE_CLIENT_IDS,
    ticketmasterApiKey: e.TICKETMASTER_API_KEY,
    anthropicApiKey: e.ANTHROPIC_API_KEY,
    aiModel: e.AI_MODEL,
    aiDailyLimitPerUser: e.AI_DAILY_LIMIT_PER_USER,
    corsOrigins: e.CORS_ORIGINS,
  });
}

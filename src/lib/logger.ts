import { pino, type DestinationStream, type Logger } from 'pino';

export type { Logger };

/** Paths whose values are replaced with [REDACTED] in every log line. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'password',
  'refreshToken',
  'accessToken',
  'idToken',
  '*.password',
  '*.refreshToken',
  '*.accessToken',
  '*.idToken',
];

export function createLogger(options: { level?: string; destination?: DestinationStream } = {}): Logger {
  const config = { level: options.level ?? 'info', redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } };
  return options.destination ? pino(config, options.destination) : pino(config);
}

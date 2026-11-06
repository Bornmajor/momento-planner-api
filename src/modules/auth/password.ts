import bcrypt from 'bcryptjs';
import { z } from 'zod';

export const DEFAULT_BCRYPT_ROUNDS = 12;

/** bcrypt only uses the first 72 bytes of a password, so longer ones are rejected rather than silently cut. */
const BCRYPT_MAX_BYTES = 72;

export const passwordSchema = z
  .string()
  .min(8, 'must be at least 8 characters')
  .refine((p) => Buffer.byteLength(p, 'utf8') <= BCRYPT_MAX_BYTES, 'must be at most 72 bytes')
  .refine((p) => /[A-Za-z]/.test(p), 'must contain a letter')
  .refine((p) => /\d/.test(p), 'must contain a digit');

export function hashPassword(password: string, rounds = DEFAULT_BCRYPT_ROUNDS): Promise<string> {
  return bcrypt.hash(password, rounds);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

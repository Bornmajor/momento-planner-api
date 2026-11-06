import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BCRYPT_ROUNDS,
  hashPassword,
  passwordSchema,
  verifyPassword,
} from '../../../src/modules/auth/password.js';

describe('password policy', () => {
  it.each([
    ['Passw0rd', true, 'letters and a digit, 8 chars'],
    ['abc1234', false, 'only 7 characters'],
    ['allletters', false, 'no digit'],
    ['12345678', false, 'no letter'],
    ['a1' + 'x'.repeat(70), true, 'exactly 72 bytes'],
    ['a1' + 'x'.repeat(71), false, '73 bytes'],
    ['a1' + 'é'.repeat(35), true, '72 bytes of multi-byte characters'],
    ['a1' + 'é'.repeat(36), false, '74 bytes even though only 38 characters'],
  ])('%s -> %s (%s)', (password, ok) => {
    expect(passwordSchema.safeParse(password).success).toBe(ok);
  });
});

describe('password hashing', () => {
  it('uses bcrypt cost 12 by default', () => {
    expect(DEFAULT_BCRYPT_ROUNDS).toBe(12);
  });

  it('hashes with bcrypt and verifies the correct password only', async () => {
    const hash = await hashPassword('Passw0rd', 4);
    expect(hash).toMatch(/^\$2[aby]\$04\$/);
    expect(hash).not.toContain('Passw0rd');
    await expect(verifyPassword('Passw0rd', hash)).resolves.toBe(true);
    await expect(verifyPassword('Passw0rd!', hash)).resolves.toBe(false);
  });

  it('salts each hash', async () => {
    expect(await hashPassword('Passw0rd', 4)).not.toBe(await hashPassword('Passw0rd', 4));
  });
});

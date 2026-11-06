import { describe, expect, it } from 'vitest';
import { User, type PublicUser } from '../../../src/models/user.model.js';
import { useTestDb } from '../../helpers/mongo.js';

useTestDb();

const base = { firstName: 'Ada', lastName: 'Lovelace' };

describe('User model', () => {
  it('stores email lowercased and trimmed', async () => {
    const user = await User.create({ ...base, email: '  Ada@Example.COM ', passwordHash: 'h' });
    expect(user.email).toBe('ada@example.com');
  });

  it('rejects a duplicate email regardless of letter case', async () => {
    await User.create({ ...base, email: 'ada@example.com', passwordHash: 'h' });
    await expect(User.create({ ...base, email: 'ADA@example.com', passwordHash: 'h' })).rejects.toMatchObject(
      {
        code: 11000,
      },
    );
  });

  it('allows many users without a googleId, but not a duplicate googleId', async () => {
    await User.create({ ...base, email: 'a@example.com', passwordHash: 'h' });
    await User.create({ ...base, email: 'b@example.com', passwordHash: 'h' });
    await User.create({ ...base, email: 'c@example.com', googleId: 'g-1' });
    await expect(User.create({ ...base, email: 'd@example.com', googleId: 'g-1' })).rejects.toMatchObject({
      code: 11000,
    });
  });

  it('rejects an unsupported language', async () => {
    await expect(
      // Deliberately invalid, so the type is bypassed.
      User.create({ ...base, email: 'a@example.com', passwordHash: 'h', language: 'de' as 'en' }),
    ).rejects.toThrow();
  });

  it('serializes to the public user shape without secrets', async () => {
    const user = await User.create({ ...base, email: 'ada@example.com', passwordHash: 'secret-hash' });
    const json = JSON.parse(JSON.stringify(user));
    expect(Object.keys(json).sort()).toEqual(
      ['authProviders', 'createdAt', 'email', 'firstName', 'id', 'language', 'lastName', 'phone'].sort(),
    );
    expect(json).toMatchObject({
      id: user.id,
      email: 'ada@example.com',
      phone: null,
      language: 'en',
      authProviders: ['password'],
    });
    expect(JSON.stringify(json)).not.toContain('secret-hash');
  });

  it('lists every sign-in method in authProviders', async () => {
    const google = await User.create({ ...base, email: 'g@example.com', googleId: 'g-1' });
    const both = await User.create({ ...base, email: 'b@example.com', passwordHash: 'h', googleId: 'g-2' });
    const publicOf = (doc: unknown) => JSON.parse(JSON.stringify(doc)) as PublicUser;
    expect(publicOf(google).authProviders).toEqual(['google']);
    expect(publicOf(both).authProviders).toEqual(['password', 'google']);
  });
});

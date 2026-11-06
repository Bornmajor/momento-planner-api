import { describe, expect, it, vi } from 'vitest';
import { createGoogleVerifier } from '../../../src/modules/auth/google-verifier.js';

const CLIENT_IDS = ['web.apps.googleusercontent.com', 'android.apps.googleusercontent.com'];

function fakeClient(payload: Record<string, unknown> | undefined) {
  return { verifyIdToken: vi.fn().mockResolvedValue({ getPayload: () => payload }) };
}

describe('Google ID token verifier', () => {
  it('checks the token against the configured client IDs and maps the profile', async () => {
    const client = fakeClient({
      sub: 'g-123',
      email: 'grace@example.com',
      email_verified: true,
      given_name: 'Grace',
      family_name: 'Hopper',
    });
    const verifier = createGoogleVerifier(CLIENT_IDS, client);

    await expect(verifier.verify('id-token')).resolves.toEqual({
      sub: 'g-123',
      email: 'grace@example.com',
      emailVerified: true,
      givenName: 'Grace',
      familyName: 'Hopper',
    });
    expect(client.verifyIdToken).toHaveBeenCalledWith({ idToken: 'id-token', audience: CLIENT_IDS });
  });

  it('rejects tokens the Google library rejects', async () => {
    const client = { verifyIdToken: vi.fn().mockRejectedValue(new Error('Wrong recipient')) };
    await expect(createGoogleVerifier(CLIENT_IDS, client).verify('bad')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('rejects tokens without a subject or email', async () => {
    await expect(
      createGoogleVerifier(CLIENT_IDS, fakeClient({ sub: 'g-1' })).verify('t'),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(createGoogleVerifier(CLIENT_IDS, fakeClient(undefined)).verify('t')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('rejects everything when no client IDs are configured', async () => {
    const client = fakeClient({ sub: 'g-1', email: 'a@example.com', email_verified: true });
    await expect(createGoogleVerifier([], client).verify('t')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    expect(client.verifyIdToken).not.toHaveBeenCalled();
  });
});

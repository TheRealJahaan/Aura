import request from 'supertest';
import { pkceChallenge, randomToken, sha256Hex } from '../src/common/crypto';
import { createTestApp, deleteUser, TestApp } from './test-app';

describe('Google sign-in (e2e)', () => {
  let t: TestApp;
  const email = 'jahaan@example.com';

  beforeAll(async () => {
    t = await createTestApp();
  });

  beforeEach(async () => {
    await deleteUser(t.prisma, email);
    t.oauth.result.refreshToken = 'google-refresh-token-1';
    t.oauth.result.profile.emailVerified = true;
  });

  afterAll(async () => {
    await deleteUser(t.prisma, email);
    await t.app.close();
  });

  const http = () => request(t.app.getHttpServer());

  /** Runs the browser part of sign-in and returns the one-time code sent to the app. */
  async function browserSignIn(verifier: string, port = 54321): Promise<string> {
    const start = await http().get('/auth/google/start').query({ challenge: pkceChallenge(verifier), port }).expect(302);
    const state = new URL(start.headers.location).searchParams.get('state');
    expect(state).toBeTruthy();
    const callback = await http().get('/auth/google/callback').query({ state, code: 'good-google-code' }).expect(302);
    const redirect = new URL(callback.headers.location);
    expect(`${redirect.origin}${redirect.pathname}`).toBe(`http://127.0.0.1:${port}/callback`);
    return redirect.searchParams.get('code') as string;
  }

  it('signs in with PKCE and returns a session token', async () => {
    const verifier = randomToken(32);
    const code = await browserSignIn(verifier);

    const res = await http().post('/auth/token').send({ code, verifier }).expect(200);
    expect(res.body.token).toMatch(/^aura_[A-Za-z0-9_-]{43}$/);
    expect(res.body.user).toMatchObject({ email, name: 'Jahaan Suthar', google: { connected: true, missingServices: [] } });

    // Only hashes and ciphertext are stored.
    const connection = await t.prisma.googleConnection.findFirstOrThrow({ where: { user: { email } } });
    expect(connection.encryptedRefreshToken).toMatch(/^v1\./);
    expect(connection.encryptedRefreshToken).not.toContain('google-refresh-token-1');
    const session = await t.prisma.session.findFirstOrThrow({ where: { user: { email } } });
    expect(session.tokenHash).toBe(sha256Hex(res.body.token));

    await http().get('/me').set('Authorization', `Bearer ${res.body.token}`).expect(200);
  });

  it('rejects a code used twice', async () => {
    const verifier = randomToken(32);
    const code = await browserSignIn(verifier);
    await http().post('/auth/token').send({ code, verifier }).expect(200);
    await http().post('/auth/token').send({ code, verifier }).expect(401);
  });

  it('rejects the wrong verifier, and the code is then used up', async () => {
    const verifier = randomToken(32);
    const code = await browserSignIn(verifier);
    await http().post('/auth/token').send({ code, verifier: randomToken(32) }).expect(401);
    await http().post('/auth/token').send({ code, verifier }).expect(401);
  });

  it('refuses a callback that reuses a finished sign-in', async () => {
    const verifier = randomToken(32);
    const start = await http().get('/auth/google/start').query({ challenge: pkceChallenge(verifier), port: 50000 }).expect(302);
    const state = new URL(start.headers.location).searchParams.get('state');
    await http().get('/auth/google/callback').query({ state, code: 'good-google-code' }).expect(302);
    const again = await http().get('/auth/google/callback').query({ state, code: 'good-google-code' }).expect(400);
    expect(again.text).toContain('This sign-in link has expired');
  });

  it('explains when the user says no on Google', async () => {
    const start = await http().get('/auth/google/start').query({ challenge: pkceChallenge(randomToken(32)), port: 50000 });
    const state = new URL(start.headers.location).searchParams.get('state');
    const res = await http().get('/auth/google/callback').query({ state, error: 'access_denied' }).expect(400);
    expect(res.text).toContain('You chose not to give Aura access.');
  });

  it('explains a missing refresh token', async () => {
    t.oauth.result.refreshToken = null;
    const start = await http().get('/auth/google/start').query({ challenge: pkceChallenge(randomToken(32)), port: 50000 });
    const state = new URL(start.headers.location).searchParams.get('state');
    const res = await http().get('/auth/google/callback').query({ state, code: 'good-google-code' }).expect(400);
    expect(res.text).toContain('myaccount.google.com/permissions');
  });

  it('rejects a broken start link', async () => {
    await http().get('/auth/google/start').query({ challenge: 'short', port: 80 }).expect(400);
  });

  it('needs a valid token for /me', async () => {
    await http().get('/me').expect(401);
    await http().get('/me').set('Authorization', 'Bearer aura_not-a-real-token').expect(401);
  });

  it('updates the time zone, signs out, and disconnects Google', async () => {
    const verifier = randomToken(32);
    const code = await browserSignIn(verifier);
    const { body } = await http().post('/auth/token').send({ code, verifier }).expect(200);
    const auth = { Authorization: `Bearer ${body.token}` };

    const updated = await http().patch('/me').set(auth).send({ timezone: 'America/New_York' }).expect(200);
    expect(updated.body.timezone).toBe('America/New_York');
    await http().patch('/me').set(auth).send({ timezone: 'Mars/Olympus' }).expect(400);

    await http().delete('/me/google').set(auth).expect(204);
    expect(t.oauth.revoked).toContain('google-refresh-token-1');
    await http().get('/me').set(auth).expect(401);
    expect(await t.prisma.googleConnection.count({ where: { user: { email } } })).toBe(0);
  });

  it('signs out one device', async () => {
    const verifier = randomToken(32);
    const code = await browserSignIn(verifier);
    const { body } = await http().post('/auth/token').send({ code, verifier }).expect(200);
    await http().post('/auth/logout').set('Authorization', `Bearer ${body.token}`).expect(204);
    await http().get('/me').set('Authorization', `Bearer ${body.token}`).expect(401);
  });
});

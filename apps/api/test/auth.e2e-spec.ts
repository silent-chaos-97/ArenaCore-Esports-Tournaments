import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from './utils/app.js';
import { bearer, enableMfa, refreshCookieOf, registerUser, totp } from './utils/auth.js';
import { resetDb } from './utils/db.js';

describe('identity (AUTH-01, AUTH-02)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await resetDb(app);
  });
  afterAll(async () => {
    await app.close();
  });

  it('registers a user with a player profile and returns tokens', async () => {
    const res = await http()
      .post('/api/v1/auth/register')
      .send({ email: '  Ace@Example.com ', password: 'correct-horse-battery', displayName: 'Ace' })
      .expect(201);
    expect(res.body).toMatchObject({ accessToken: expect.any(String), expiresIn: 900 });
    const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).join(';');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/api/v1/auth');

    const me = await http()
      .get('/api/v1/auth/me')
      .set('authorization', `Bearer ${res.body.accessToken}`)
      .expect(200);
    expect(me.body).toMatchObject({
      email: 'ace@example.com',
      displayName: 'Ace',
      mfaEnabled: false,
      memberships: [],
    });
    expect(me.body.playerId).toEqual(expect.any(String));
  });

  it('rejects duplicate emails and weak passwords', async () => {
    await registerUser(app, { email: 'dup@example.com' });
    const dup = await http()
      .post('/api/v1/auth/register')
      .send({ email: 'DUP@example.com', password: 'correct-horse-battery', displayName: 'Dup' })
      .expect(409);
    expect(dup.body.code).toBe('EMAIL_TAKEN');
    const weak = await http()
      .post('/api/v1/auth/register')
      .send({ email: 'weak@example.com', password: 'short', displayName: 'Weak' })
      .expect(400);
    expect(weak.body.errors[0].path).toBe('password');
  });

  it('logs in and rejects bad credentials without revealing which part was wrong', async () => {
    await registerUser(app, { email: 'login@example.com' });
    await http()
      .post('/api/v1/auth/login')
      .send({ email: 'login@example.com', password: 'correct-horse-battery' })
      .expect(200);
    const wrongPw = await http()
      .post('/api/v1/auth/login')
      .send({ email: 'login@example.com', password: 'nope' });
    const noUser = await http()
      .post('/api/v1/auth/login')
      .send({ email: 'ghost@example.com', password: 'nope' });
    expect(wrongPw.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(wrongPw.body.title).toBe(noUser.body.title);
  });

  it('requires authentication for protected routes', async () => {
    await http().get('/api/v1/auth/me').expect(401);
    await http().get('/api/v1/auth/me').set('authorization', 'Bearer garbage').expect(401);
  });

  it('rotates refresh tokens and revokes the family when a used token is replayed', async () => {
    const user = await registerUser(app);
    const first = await http()
      .post('/api/v1/auth/refresh')
      .set('cookie', user.refreshCookie)
      .expect(200);
    const rotated = refreshCookieOf(first);
    expect(rotated).not.toBe(user.refreshCookie);

    // Replaying the original token is treated as theft.
    await http().post('/api/v1/auth/refresh').set('cookie', user.refreshCookie).expect(401);
    // ...which also invalidates the legitimately rotated token.
    await http().post('/api/v1/auth/refresh').set('cookie', rotated).expect(401);
  });

  it('logout revokes the refresh session', async () => {
    const user = await registerUser(app);
    await http().post('/api/v1/auth/logout').set('cookie', user.refreshCookie).expect(204);
    await http().post('/api/v1/auth/refresh').set('cookie', user.refreshCookie).expect(401);
  });

  it('enrols TOTP MFA and then requires a code at login', async () => {
    const user = await enableMfa(app, await registerUser(app, { email: 'mfa@example.com' }));
    const me = await http().get('/api/v1/auth/me').set(bearer(user)).expect(200);
    expect(me.body.mfaEnabled).toBe(true);

    const missing = await http()
      .post('/api/v1/auth/login')
      .send({ email: 'mfa@example.com', password: 'correct-horse-battery' })
      .expect(401);
    expect(missing.body.code).toBe('MFA_REQUIRED');

    const wrong = await http()
      .post('/api/v1/auth/login')
      .send({ email: 'mfa@example.com', password: 'correct-horse-battery', mfaCode: '000000' })
      .expect(401);
    expect(wrong.body.code).toBe('MFA_INVALID');

    await http()
      .post('/api/v1/auth/login')
      .send({
        email: 'mfa@example.com',
        password: 'correct-horse-battery',
        mfaCode: await totp(user.mfaSecret!),
      })
      .expect(200);
  });

  it('rejects enabling MFA with a wrong code', async () => {
    const user = await registerUser(app);
    await http().post('/api/v1/auth/mfa/setup').set(bearer(user)).expect(200);
    await http()
      .post('/api/v1/auth/mfa/enable')
      .set(bearer(user))
      .send({ code: '123456' })
      .expect(401);
  });
});

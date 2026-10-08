import type { INestApplication } from '@nestjs/common';
import { generate } from 'otplib';
import request from 'supertest';

export interface TestUser {
  id: string;
  email: string;
  token: string;
  refreshCookie: string;
  mfaSecret?: string;
}

let counter = 0;

export function refreshCookieOf(res: request.Response): string {
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = cookies.find((c) => c.startsWith('ac_rt='));
  if (!cookie) throw new Error('No refresh cookie set');
  return cookie.split(';')[0]!;
}

export async function registerUser(
  app: INestApplication,
  overrides: { email?: string; displayName?: string; password?: string } = {},
): Promise<TestUser> {
  counter += 1;
  const email = overrides.email ?? `user${counter}-${Date.now()}@example.com`;
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({
      email,
      password: overrides.password ?? 'correct-horse-battery',
      displayName: overrides.displayName ?? `Player ${counter}`,
    })
    .expect(201);
  const me = await request(app.getHttpServer())
    .get('/api/v1/auth/me')
    .set('authorization', `Bearer ${res.body.accessToken}`)
    .expect(200);
  return {
    id: me.body.id,
    email,
    token: res.body.accessToken,
    refreshCookie: refreshCookieOf(res),
  };
}

export function totp(secret: string): Promise<string> {
  return generate({ secret });
}

/** Enrols TOTP and returns the user upgraded to an MFA-verified session. */
export async function enableMfa(app: INestApplication, user: TestUser): Promise<TestUser> {
  const setup = await request(app.getHttpServer())
    .post('/api/v1/auth/mfa/setup')
    .set('authorization', `Bearer ${user.token}`)
    .expect(200);
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/mfa/enable')
    .set('authorization', `Bearer ${user.token}`)
    .send({ code: await totp(setup.body.secret) })
    .expect(200);
  return {
    ...user,
    token: res.body.accessToken,
    refreshCookie: refreshCookieOf(res),
    mfaSecret: setup.body.secret,
  };
}

/** A user with MFA enabled — required for Owner/Admin actions. */
export async function registerPrivilegedUser(app: INestApplication): Promise<TestUser> {
  return enableMfa(app, await registerUser(app));
}

export const bearer = (user: TestUser) => ({ authorization: `Bearer ${user.token}` });

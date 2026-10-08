import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/infra/prisma/prisma.service.js';
import { bearer, registerPrivilegedUser, type TestUser } from './auth.js';

const HOUR = 60 * 60 * 1000;

export function tournamentInput(gameId: string, overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    name: 'Spring Cup',
    gameId,
    region: 'EU',
    format: 'SINGLE_ELIMINATION',
    teamSize: 2,
    maxSubstitutes: 1,
    maxTeams: 8,
    registrationOpensAt: new Date(now - HOUR).toISOString(),
    registrationClosesAt: new Date(now + 24 * HOUR).toISOString(),
    checkInOpensAt: new Date(now + 24 * HOUR).toISOString(),
    checkInClosesAt: new Date(now + 25 * HOUR).toISOString(),
    startsAt: new Date(now + 26 * HOUR).toISOString(),
    rules: 'Be excellent to each other. Best of one. Captains report scores.',
    ...overrides,
  };
}

export interface OrgFixture {
  owner: TestUser;
  orgId: string;
}

export async function createOrg(app: INestApplication, name = 'Arena League'): Promise<OrgFixture> {
  const owner = await registerPrivilegedUser(app);
  const res = await request(app.getHttpServer())
    .post('/api/v1/orgs')
    .set(bearer(owner))
    .send({ name })
    .expect(201);
  return { owner, orgId: res.body.id };
}

export async function gameIdOf(app: INestApplication, slug = 'valorant'): Promise<string> {
  return (await app.get(PrismaService).game.findUniqueOrThrow({ where: { slug } })).id;
}

export async function createTournament(
  app: INestApplication,
  org: OrgFixture,
  overrides: Record<string, unknown> = {},
  publish = true,
): Promise<{ id: string; slug: string; version: number }> {
  const http = request(app.getHttpServer());
  const created = await http
    .post(`/api/v1/orgs/${org.orgId}/tournaments`)
    .set(bearer(org.owner))
    .send(tournamentInput(await gameIdOf(app), overrides))
    .expect(201);
  if (!publish) return created.body;
  const published = await request(app.getHttpServer())
    .post(`/api/v1/orgs/${org.orgId}/tournaments/${created.body.id}/publish`)
    .set(bearer(org.owner))
    .expect(200);
  return published.body;
}

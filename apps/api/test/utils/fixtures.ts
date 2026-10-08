import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/infra/prisma/prisma.service.js';
import { bearer, registerPrivilegedUser, registerUser, type TestUser } from './auth.js';

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

export interface TeamFixture {
  teamId: string;
  name: string;
  captain: TestUser & { playerId: string };
  players: (TestUser & { playerId: string })[];
  /** Captain first, then players, all as starters except trailing substitutes. */
  roster: { playerId: string; role: 'CAPTAIN' | 'PLAYER' | 'SUBSTITUTE' }[];
}

let teamCounter = 0;

/** A team whose members all joined and linked accounts for the given game. */
export async function createTeam(
  app: INestApplication,
  options: {
    size?: number;
    substitutes?: number;
    gameSlug?: string;
    name?: string;
    linkAccounts?: boolean;
  } = {},
): Promise<TeamFixture> {
  const { size = 2, substitutes = 0, gameSlug = 'valorant', linkAccounts = true } = options;
  teamCounter += 1;
  const name = options.name ?? `Team ${teamCounter}`;
  const http = () => request(app.getHttpServer());
  const gameId = await gameIdOf(app, gameSlug);
  const prisma = app.get(PrismaService);
  const withPlayer = async (u: TestUser) => {
    const player = await prisma.player.findUniqueOrThrow({ where: { userId: u.id } });
    if (linkAccounts) {
      await http()
        .post('/api/v1/players/me/game-accounts')
        .set(bearer(u))
        .send({
          gameId,
          externalPlayerId: `${u.email}#${gameSlug}`,
          username: u.email.split('@')[0],
        })
        .expect(201);
    }
    return { ...u, playerId: player.id };
  };

  const captain = await withPlayer(await registerUser(app));
  const team = await http().post('/api/v1/teams').set(bearer(captain)).send({ name }).expect(201);
  const players: TeamFixture['players'] = [];
  for (let i = 1; i < size + substitutes; i++) {
    const p = await withPlayer(await registerUser(app));
    const invite = await http()
      .post(`/api/v1/teams/${team.body.id}/invites`)
      .set(bearer(captain))
      .send({ email: p.email, role: i >= size ? 'SUBSTITUTE' : 'PLAYER' })
      .expect(201);
    await http().post(`/api/v1/team-invites/${invite.body.id}/accept`).set(bearer(p)).expect(200);
    players.push(p);
  }
  const roster: TeamFixture['roster'] = [
    { playerId: captain.playerId, role: 'CAPTAIN' },
    ...players.map((p, i) => ({
      playerId: p.playerId,
      role: i + 1 >= size ? ('SUBSTITUTE' as const) : ('PLAYER' as const),
    })),
  ];
  return { teamId: team.body.id, name, captain, players, roster };
}

export function registerTeam(
  app: INestApplication,
  tournamentId: string,
  team: TeamFixture,
  rulesVersion = 1,
): request.Test {
  return request(app.getHttpServer())
    .post(`/api/v1/tournaments/${tournamentId}/registrations`)
    .set(bearer(team.captain))
    .send({ teamId: team.teamId, members: team.roster, acceptRules: true, rulesVersion });
}

/** Registers and approves `count` teams; returns them in registration order. */
export async function approvedTeams(
  app: INestApplication,
  org: OrgFixture,
  tournamentId: string,
  count: number,
  teamOptions: Parameters<typeof createTeam>[1] = {},
): Promise<(TeamFixture & { registrationId: string })[]> {
  const out: (TeamFixture & { registrationId: string })[] = [];
  for (let i = 0; i < count; i++) {
    const team = await createTeam(app, teamOptions);
    const reg = await registerTeam(app, tournamentId, team).expect(201);
    await request(app.getHttpServer())
      .post(
        `/api/v1/orgs/${org.orgId}/tournaments/${tournamentId}/registrations/${reg.body.id}/approve`,
      )
      .set(bearer(org.owner))
      .expect(200);
    out.push({ ...team, registrationId: reg.body.id });
  }
  return out;
}

/** Tournament without a check-in window, so every approved team takes part. */
export const NO_CHECK_IN = { checkInOpensAt: null, checkInClosesAt: null } as const;

export function openCheckInWindow(): Record<string, string> {
  const now = Date.now();
  return {
    registrationOpensAt: new Date(now - 2 * 3600_000).toISOString(),
    registrationClosesAt: new Date(now + 1800_000).toISOString(),
    checkInOpensAt: new Date(now - 3600_000).toISOString(),
    checkInClosesAt: new Date(now + 3600_000).toISOString(),
    startsAt: new Date(now + 2 * 3600_000).toISOString(),
  };
}

export interface StartedTournament {
  tournamentId: string;
  teams: (TeamFixture & { registrationId: string })[];
  /** Captain of the team holding a registration. */
  captainOf(registrationId: string): TestUser;
  bracket(): Promise<{ status: string; matches: Record<string, MatchView> }>;
}

export interface MatchView {
  id: string;
  key: string;
  status: string;
  version: number;
  a: { registrationId: string; teamId: string } | null;
  b: { registrationId: string; teamId: string } | null;
  winnerSlot: 'A' | 'B' | null;
  scoreA: number | null;
  scoreB: number | null;
}

/** Creates, fills (seeded in registration order) and starts a tournament. */
export async function startTournament(
  app: INestApplication,
  org: OrgFixture,
  teamCount: number,
  overrides: Record<string, unknown> = {},
): Promise<StartedTournament> {
  const http = () => request(app.getHttpServer());
  const t = await createTournament(app, org, {
    checkInOpensAt: null,
    checkInClosesAt: null,
    matchCheckInMinutes: 0,
    maxTeams: 16,
    ...overrides,
  });
  const teams = await approvedTeams(app, org, t.id, teamCount);
  const base = `/api/v1/orgs/${org.orgId}/tournaments/${t.id}`;
  await http()
    .put(`${base}/seeding`)
    .set(bearer(org.owner))
    .send({ order: teams.map((x) => x.registrationId) })
    .expect(200);
  await http().post(`${base}/start`).set(bearer(org.owner)).expect(200);
  const byReg = new Map(teams.map((x) => [x.registrationId, x]));
  return {
    tournamentId: t.id,
    teams,
    captainOf: (registrationId) => byReg.get(registrationId)!.captain,
    async bracket() {
      const res = await http().get(`${base}/bracket`).set(bearer(org.owner)).expect(200);
      const matches: Record<string, MatchView> = {};
      for (const round of res.body.stages[0].rounds)
        for (const m of round.matches) matches[m.key] = m;
      return { status: res.body.status, matches };
    },
  };
}

/** Both captains report the same score. */
export async function playMatch(
  app: INestApplication,
  started: StartedTournament,
  match: MatchView,
  scoreA: number,
  scoreB: number,
) {
  for (const side of [match.a!, match.b!]) {
    await request(app.getHttpServer())
      .post(`/api/v1/matches/${match.id}/results`)
      .set(bearer(started.captainOf(side.registrationId)))
      .send({ scoreA, scoreB })
      .expect(200);
  }
}

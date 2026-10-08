import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { bearer, registerUser } from './utils/auth.js';
import { resetDb } from './utils/db.js';
import {
  approvedTeams,
  createOrg,
  createTournament,
  NO_CHECK_IN,
  openCheckInWindow,
  type OrgFixture,
} from './utils/fixtures.js';

describe('competition stage: check-in, seeding, bracket generation, scheduling', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let org: OrgFixture;
  const http = () => request(app.getHttpServer());
  const tBase = (id: string) => `/api/v1/orgs/${org.orgId}/tournaments/${id}`;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    prisma = await resetDb(app);
    org = await createOrg(app);
  });
  afterAll(async () => {
    await app.close();
  });

  it('only checked-in teams enter the bracket when check-in is used', async () => {
    const t = await createTournament(app, org, openCheckInWindow());
    const teams = await approvedTeams(app, org, t.id, 3);
    for (const team of teams.slice(0, 2)) {
      const res = await http()
        .post(`/api/v1/tournaments/${t.id}/check-in`)
        .set(bearer(team.captain))
        .send({ teamId: team.teamId })
        .expect(200);
      expect(res.body.status).toBe('CHECKED_IN');
    }
    // Repeating check-in is harmless.
    await http()
      .post(`/api/v1/tournaments/${t.id}/check-in`)
      .set(bearer(teams[0]!.captain))
      .send({ teamId: teams[0]!.teamId })
      .expect(200);

    const bracket = await http()
      .post(`${tBase(t.id)}/start`)
      .set(bearer(org.owner))
      .expect(200);
    expect(bracket.body.status).toBe('IN_PROGRESS');
    const matches = bracket.body.stages[0].rounds.flatMap((r: { matches: unknown[] }) => r.matches);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ status: 'SCHEDULED', roundName: 'Final' });
    const teamsInBracket = [matches[0].a.teamId, matches[0].b.teamId].sort();
    expect(teamsInBracket).toEqual([teams[0]!.teamId, teams[1]!.teamId].sort());
  });

  it('rejects check-in outside the window and allows an organizer override', async () => {
    const t = await createTournament(app, org); // default fixture window is tomorrow
    const [team] = await approvedTeams(app, org, t.id, 1);
    const closed = await http()
      .post(`/api/v1/tournaments/${t.id}/check-in`)
      .set(bearer(team!.captain))
      .send({ teamId: team!.teamId })
      .expect(409);
    expect(closed.body.code).toBe('CHECK_IN_CLOSED');
    const forced = await http()
      .post(`${tBase(t.id)}/registrations/${team!.registrationId}/check-in`)
      .set(bearer(org.owner))
      .expect(200);
    expect(forced.body.status).toBe('CHECKED_IN');
  });

  it('generates a single-elimination bracket with byes for the top seeds', async () => {
    const t = await createTournament(app, org, { ...NO_CHECK_IN, maxTeams: 8 });
    const teams = await approvedTeams(app, org, t.id, 5);
    await http()
      .put(`${tBase(t.id)}/seeding`)
      .set(bearer(org.owner))
      .send({ order: teams.map((x) => x.registrationId) })
      .expect(200);
    const bracket = await http()
      .post(`${tBase(t.id)}/start`)
      .set(bearer(org.owner))
      .expect(200);
    const rounds = bracket.body.stages[0].rounds;
    expect(rounds.map((r: { name: string }) => r.name)).toEqual([
      'Quarterfinals',
      'Semifinals',
      'Final',
    ]);
    const firstRound = rounds[0].matches;
    const byes = firstRound.filter((m: { isBye: boolean }) => m.isBye);
    expect(byes).toHaveLength(3);
    expect(byes.map((m: { a: { seed: number } }) => m.a.seed).sort()).toEqual([1, 2, 3]);
    expect(firstRound.filter((m: { status: string }) => m.status === 'SCHEDULED')).toHaveLength(1);
    // Seed 1 already advanced into the semifinal.
    const semi = rounds[1].matches.find((m: { key: string }) => m.key === 'W2-1');
    expect(semi.a).toMatchObject({ seed: 1, teamId: teams[0]!.teamId });

    expect(await prisma.standing.count({ where: { tournamentId: t.id } })).toBe(5);
    expect(await prisma.outboxEvent.count({ where: { type: 'MatchReady' } })).toBe(2); // W1 4v5 and W2-2 (2 v 3)
    const stored = await prisma.tournament.findUniqueOrThrow({ where: { id: t.id } });
    expect(stored.status).toBe('IN_PROGRESS');
  });

  it('builds a double-elimination bracket and locks seeding after start', async () => {
    const t = await createTournament(app, org, {
      ...NO_CHECK_IN,
      format: 'DOUBLE_ELIMINATION',
      bestOf: 3,
      finalsBestOf: 5,
    });
    const teams = await approvedTeams(app, org, t.id, 4);
    await http()
      .post(`${tBase(t.id)}/seeding/randomize`)
      .set(bearer(org.owner))
      .send({ seed: 7 })
      .expect(200);
    const bracket = await http()
      .post(`${tBase(t.id)}/start`)
      .set(bearer(org.owner))
      .expect(200);
    const rounds = bracket.body.stages[0].rounds;
    expect(rounds.map((r: { name: string }) => r.name)).toEqual([
      'Upper Round 1',
      'Upper Final',
      'Lower Round 1',
      'Lower Final',
      'Grand Final',
      'Grand Final Reset',
    ]);
    expect(rounds.find((r: { name: string }) => r.name === 'Grand Final').bestOf).toBe(5);
    expect(rounds[0].bestOf).toBe(3);
    await http()
      .put(`${tBase(t.id)}/seeding`)
      .set(bearer(org.owner))
      .send({ order: teams.map((x) => x.registrationId) })
      .expect(409);
    await http()
      .post(`${tBase(t.id)}/start`)
      .set(bearer(org.owner))
      .expect(409);
  });

  it('requires at least two teams and organizer rights to start', async () => {
    const t = await createTournament(app, org, NO_CHECK_IN);
    await approvedTeams(app, org, t.id, 1);
    const res = await http()
      .post(`${tBase(t.id)}/start`)
      .set(bearer(org.owner))
      .expect(422);
    expect(res.body.code).toBe('NOT_ENOUGH_TEAMS');

    const referee = await registerUser(app);
    const invite = await http()
      .post(`/api/v1/orgs/${org.orgId}/invites`)
      .set(bearer(org.owner))
      .send({ email: referee.email, role: 'REFEREE' })
      .expect(201);
    await http()
      .post('/api/v1/invites/accept')
      .set(bearer(referee))
      .send({ token: invite.body.token })
      .expect(200);
    await http()
      .post(`${tBase(t.id)}/start`)
      .set(bearer(referee))
      .expect(403);
  });

  it('reschedules a match with audit and a MatchRescheduled event', async () => {
    const t = await createTournament(app, org, NO_CHECK_IN);
    await approvedTeams(app, org, t.id, 2);
    const bracket = await http()
      .post(`${tBase(t.id)}/start`)
      .set(bearer(org.owner))
      .expect(200);
    const match = bracket.body.stages[0].rounds[0].matches[0];
    const when = new Date(Date.now() + 3 * 86400_000).toISOString();
    const res = await http()
      .patch(`/api/v1/orgs/${org.orgId}/matches/${match.id}/schedule`)
      .set(bearer(org.owner))
      .send({ scheduledAt: when, reason: 'Broadcast slot' })
      .expect(200);
    expect(res.body.scheduledAt).toBe(when);
    expect(new Date(res.body.checkInOpensAt).getTime()).toBe(
      new Date(when).getTime() - 15 * 60_000,
    );
    expect(await prisma.outboxEvent.count({ where: { type: 'MatchRescheduled' } })).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { action: 'match.rescheduled', reason: 'Broadcast slot' },
      }),
    ).toBe(1);
  });
});

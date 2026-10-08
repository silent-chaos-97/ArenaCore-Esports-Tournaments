import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { bearer } from './utils/auth.js';
import { resetDb } from './utils/db.js';
import {
  approvedTeams,
  createOrg,
  createTeam,
  createTournament,
  playMatch,
  startTournament,
  type OrgFixture,
} from './utils/fixtures.js';

/** Acceptance criterion 14 and the "transactional bracket engine" risk mitigation under load. */
describe('concurrency and duplicate delivery', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let org: OrgFixture;
  const http = () => request(app.getHttpServer());

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

  it('both captains confirming at the same instant produce exactly one result and one advancement', async () => {
    const started = await startTournament(app, org, 4);
    const m = (await started.bracket()).matches['W1-1']!;
    const report = (registrationId: string) =>
      http()
        .post(`/api/v1/matches/${m.id}/results`)
        .set(bearer(started.captainOf(registrationId)))
        .send({ scoreA: 1, scoreB: 0 });
    // Each captain fires several retries in parallel, as a flaky client might.
    const responses = await Promise.all(
      [...Array(4)].flatMap(() => [report(m.a!.registrationId), report(m.b!.registrationId)]),
    );
    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(await prisma.outboxEvent.count({ where: { type: 'MatchCompleted' } })).toBe(1);
    expect(await prisma.matchResult.count({ where: { matchId: m.id } })).toBe(2);
    const next = (await started.bracket()).matches['W2-1']!;
    expect(next.a!.registrationId).toBe(m.a!.registrationId);
  });

  it('results for different matches of one bracket advance concurrently without lost updates', async () => {
    const started = await startTournament(app, org, 16);
    const { matches } = await started.bracket();
    const firstRound = Object.values(matches).filter((m) => m.key.startsWith('W1-'));
    await Promise.all(firstRound.map((m) => playMatch(app, started, m, 1, 0)));
    const after = (await started.bracket()).matches;
    const secondRound = Object.values(after).filter((m) => m.key.startsWith('W2-'));
    expect(secondRound).toHaveLength(4);
    for (const m of secondRound) {
      expect(m.status).toBe('READY');
      expect(m.a).not.toBeNull();
      expect(m.b).not.toBeNull();
    }
    const stage = await prisma.stage.findFirstOrThrow({
      where: { tournamentId: started.tournamentId },
    });
    const engine = (stage.settings as { state: { matches: Record<string, { status: string }> } })
      .state.matches;
    expect(
      Object.entries(engine).filter(([k, s]) => k.startsWith('W1-') && s.status === 'completed'),
    ).toHaveLength(8);
  });

  it('duplicate registration submissions with one idempotency key create one registration', async () => {
    const t = await createTournament(app, org);
    const team = await createTeam(app, { size: 2 });
    const send = () =>
      http()
        .post(`/api/v1/tournaments/${t.id}/registrations`)
        .set(bearer(team.captain))
        .set('idempotency-key', 'concurrent-registration-1')
        .send({ teamId: team.teamId, members: team.roster, acceptRules: true, rulesVersion: 1 });
    const results = await Promise.all([send(), send(), send(), send()]);
    // One wins; the others replay it or are told it is still in progress — never a second row.
    expect(results.map((r) => r.status).every((s) => s === 201 || s === 409)).toBe(true);
    expect(await prisma.registration.count({ where: { tournamentId: t.id } })).toBe(1);
  });

  it('approvals racing for the last slot never exceed capacity', async () => {
    const t = await createTournament(app, org, { maxTeams: 2 });
    const teams = [];
    for (let i = 0; i < 4; i++) {
      const team = await createTeam(app, { size: 2 });
      const reg = await http()
        .post(`/api/v1/tournaments/${t.id}/registrations`)
        .set(bearer(team.captain))
        .send({ teamId: team.teamId, members: team.roster, acceptRules: true, rulesVersion: 1 })
        .expect(201);
      teams.push(reg.body.id as string);
    }
    const results = await Promise.all(
      teams.map((id) =>
        http()
          .post(`/api/v1/orgs/${org.orgId}/tournaments/${t.id}/registrations/${id}/approve`)
          .set(bearer(org.owner)),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(2);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    expect(
      await prisma.registration.count({ where: { tournamentId: t.id, status: 'APPROVED' } }),
    ).toBe(2);
  });

  it('starting a tournament twice in parallel creates one bracket', async () => {
    const t = await createTournament(app, org, { checkInOpensAt: null, checkInClosesAt: null });
    await approvedTeams(app, org, t.id, 4);
    const start = () =>
      http().post(`/api/v1/orgs/${org.orgId}/tournaments/${t.id}/start`).set(bearer(org.owner));
    const results = await Promise.all([start(), start(), start()]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await prisma.stage.count({ where: { tournamentId: t.id } })).toBe(1);
    expect(await prisma.match.count({ where: { tournamentId: t.id } })).toBe(3);
  });
});

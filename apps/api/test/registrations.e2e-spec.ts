import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { bearer } from './utils/auth.js';
import { resetDb } from './utils/db.js';
import {
  createOrg,
  createTeam,
  createTournament,
  registerTeam,
  type OrgFixture,
} from './utils/fixtures.js';

describe('tournament registration (workflow B)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let org: OrgFixture;
  let tournament: { id: string };
  const http = () => request(app.getHttpServer());
  const orgBase = () => `/api/v1/orgs/${org.orgId}/tournaments/${tournament.id}/registrations`;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    prisma = await resetDb(app);
    org = await createOrg(app);
    tournament = await createTournament(app, org, { maxTeams: 2 });
  });
  afterAll(async () => {
    await app.close();
  });

  it('submits a valid roster and lets the organizer approve it', async () => {
    const team = await createTeam(app, { size: 2, substitutes: 1 });
    const res = await registerTeam(app, tournament.id, team).expect(201);
    expect(res.body).toMatchObject({ status: 'SUBMITTED', validationErrors: [], rulesVersion: 1 });
    expect(res.body.members).toHaveLength(3);

    const pending = await http()
      .get(`${orgBase()}?status=SUBMITTED`)
      .set(bearer(org.owner))
      .expect(200);
    expect(pending.body).toHaveLength(1);

    await http().post(`${orgBase()}/${res.body.id}/review`).set(bearer(org.owner)).expect(200);
    const approved = await http()
      .post(`${orgBase()}/${res.body.id}/approve`)
      .set(bearer(org.owner))
      .expect(200);
    expect(approved.body.status).toBe('APPROVED');
    expect(await prisma.outboxEvent.count({ where: { type: 'RegistrationApproved' } })).toBe(1);

    // Roster is locked after approval.
    await http()
      .put(`/api/v1/registrations/${res.body.id}/roster`)
      .set(bearer(team.captain))
      .send({ members: team.roster, acceptRules: true, rulesVersion: 1 })
      .expect(409);
  });

  it('flags an invalid roster as VALIDATION_FAILED with explanations and accepts a corrected one', async () => {
    const team = await createTeam(app, { size: 2 });
    const short = { ...team, roster: team.roster.slice(0, 1) };
    const failed = await registerTeam(app, tournament.id, short).expect(201);
    expect(failed.body.status).toBe('VALIDATION_FAILED');
    expect(failed.body.validationErrors.map((e: { code: string }) => e.code)).toEqual([
      'STARTER_COUNT',
    ]);

    const fixed = await http()
      .put(`/api/v1/registrations/${failed.body.id}/roster`)
      .set(bearer(team.captain))
      .send({ members: team.roster, acceptRules: true, rulesVersion: 1 })
      .expect(200);
    expect(fixed.body).toMatchObject({ status: 'SUBMITTED', validationErrors: [] });
  });

  it('requires linked game accounts and the current rules version', async () => {
    const team = await createTeam(app, { size: 2, linkAccounts: false });
    const res = await registerTeam(app, tournament.id, team).expect(201);
    expect(res.body.validationErrors.map((e: { code: string }) => e.code)).toEqual([
      'MISSING_GAME_ACCOUNT',
      'MISSING_GAME_ACCOUNT',
    ]);
    const other = await createTeam(app, { size: 2 });
    const outdated = await registerTeam(app, tournament.id, other, 99).expect(409);
    expect(outdated.body.code).toBe('RULES_OUTDATED');
  });

  it('prevents duplicate registrations and players on two rosters', async () => {
    const team = await createTeam(app, { size: 2 });
    await registerTeam(app, tournament.id, team).expect(201);
    const dup = await registerTeam(app, tournament.id, team).expect(409);
    expect(dup.body.code).toBe('ALREADY_REGISTERED');

    // A second team (captained by the same player) cannot reuse that player.
    const second = await http()
      .post('/api/v1/teams')
      .set(bearer(team.captain))
      .send({ name: 'Alt Team' })
      .expect(201);
    const invite = await http()
      .post(`/api/v1/teams/${second.body.id}/invites`)
      .set(bearer(team.captain))
      .send({ email: team.players[0]!.email })
      .expect(201);
    await http()
      .post(`/api/v1/team-invites/${invite.body.id}/accept`)
      .set(bearer(team.players[0]!))
      .expect(200);
    const res = await http()
      .post(`/api/v1/tournaments/${tournament.id}/registrations`)
      .set(bearer(team.captain))
      .send({ teamId: second.body.id, members: team.roster, acceptRules: true, rulesVersion: 1 })
      .expect(201);
    expect(res.body.status).toBe('VALIDATION_FAILED');
    expect(res.body.validationErrors.map((e: { code: string }) => e.code)).toContain(
      'ALREADY_ON_ROSTER',
    );
  });

  it('replays an idempotent submission instead of registering twice', async () => {
    const team = await createTeam(app, { size: 2 });
    const send = () =>
      http()
        .post(`/api/v1/tournaments/${tournament.id}/registrations`)
        .set(bearer(team.captain))
        .set('idempotency-key', 'reg-key-0001')
        .send({ teamId: team.teamId, members: team.roster, acceptRules: true, rulesVersion: 1 });
    const first = await send().expect(201);
    const replay = await send().expect(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body.id).toBe(first.body.id);
    expect(await prisma.registration.count()).toBe(1);

    const misuse = await http()
      .post(`/api/v1/tournaments/${tournament.id}/registrations`)
      .set(bearer(team.captain))
      .set('idempotency-key', 'reg-key-0001')
      .send({
        teamId: team.teamId,
        members: team.roster.slice(0, 1),
        acceptRules: true,
        rulesVersion: 1,
      })
      .expect(422);
    expect(misuse.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('enforces capacity at approval and supports rejection with a reason', async () => {
    const teams = await Promise.all([1, 2, 3].map(() => createTeam(app, { size: 2 })));
    const regs = [];
    for (const team of teams)
      regs.push((await registerTeam(app, tournament.id, team).expect(201)).body);
    await http().post(`${orgBase()}/${regs[0].id}/approve`).set(bearer(org.owner)).expect(200);
    await http().post(`${orgBase()}/${regs[1].id}/approve`).set(bearer(org.owner)).expect(200);
    const full = await http()
      .post(`${orgBase()}/${regs[2].id}/approve`)
      .set(bearer(org.owner))
      .expect(409);
    expect(full.body.code).toBe('TOURNAMENT_FULL');

    const rejected = await http()
      .post(`${orgBase()}/${regs[2].id}/reject`)
      .set(bearer(org.owner))
      .send({ reason: 'Tournament is full' })
      .expect(200);
    expect(rejected.body).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'Tournament is full',
    });
  });

  it('auto-approves when the tournament does not require approval', async () => {
    const open = await createTournament(app, org, { requireApproval: false, name: 'Open Cup' });
    const team = await createTeam(app, { size: 2 });
    const res = await registerTeam(app, open.id, team).expect(201);
    expect(res.body.status).toBe('APPROVED');
  });

  it('lets captains withdraw and restricts organizer actions to authorized staff', async () => {
    const team = await createTeam(app, { size: 2 });
    const reg = (await registerTeam(app, tournament.id, team).expect(201)).body;
    await http().post(`${orgBase()}/${reg.id}/approve`).set(bearer(team.captain)).expect(404);
    await http()
      .post(`/api/v1/registrations/${reg.id}/withdraw`)
      .set(bearer(team.players[0]!))
      .expect(403);
    const withdrawn = await http()
      .post(`/api/v1/registrations/${reg.id}/withdraw`)
      .set(bearer(team.captain))
      .expect(200);
    expect(withdrawn.body).toMatchObject({ status: 'WITHDRAWN', members: [] });
    // Withdrawn teams may register again.
    await registerTeam(app, tournament.id, team).expect(201);
  });
});

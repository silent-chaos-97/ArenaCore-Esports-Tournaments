import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { bearer, registerUser } from './utils/auth.js';
import { resetDb } from './utils/db.js';
import {
  createOrg,
  createTournament,
  gameIdOf,
  tournamentInput,
  type OrgFixture,
} from './utils/fixtures.js';

describe('tournament management (TOUR-01..08)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let org: OrgFixture;
  const http = () => request(app.getHttpServer());
  const base = () => `/api/v1/orgs/${org.orgId}/tournaments`;

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

  it('creates a draft with defaults and lists it', async () => {
    const res = await http()
      .post(base())
      .set(bearer(org.owner))
      .send(tournamentInput(await gameIdOf(app)))
      .expect(201);
    expect(res.body).toMatchObject({
      status: 'DRAFT',
      slug: 'spring-cup',
      gameName: 'VALORANT',
      bestOf: 1,
      platform: 'PC',
      rulesVersion: 1,
      lockedFields: [],
    });
    const list = await http().get(base()).set(bearer(org.owner)).expect(200);
    expect(list.body).toHaveLength(1);
  });

  it('validates the schedule and best-of format', async () => {
    const gameId = await gameIdOf(app);
    const now = Date.now();
    const bad = await http()
      .post(base())
      .set(bearer(org.owner))
      .send(
        tournamentInput(gameId, {
          registrationClosesAt: new Date(now - 7200_000).toISOString(),
          bestOf: 2,
        }),
      )
      .expect(400);
    const paths = bad.body.errors.map((e: { path: string }) => e.path);
    expect(paths).toContain('bestOf');
  });

  it('publishes only when ready and emits TournamentPublished', async () => {
    const draft = await http()
      .post(base())
      .set(bearer(org.owner))
      .send(tournamentInput(await gameIdOf(app), { rules: '' }))
      .expect(201);
    const notReady = await http()
      .post(`${base()}/${draft.body.id}/publish`)
      .set(bearer(org.owner))
      .expect(422);
    expect(notReady.body.code).toBe('NOT_PUBLISHABLE');

    await http()
      .patch(`${base()}/${draft.body.id}`)
      .set(bearer(org.owner))
      .send({ version: draft.body.version, rules: 'Standard rules apply.' })
      .expect(200);
    const published = await http()
      .post(`${base()}/${draft.body.id}/publish`)
      .set(bearer(org.owner))
      .expect(200);
    expect(published.body.status).toBe('PUBLISHED');
    expect(await prisma.outboxEvent.count({ where: { type: 'TournamentPublished' } })).toBe(1);

    await http().post(`${base()}/${draft.body.id}/publish`).set(bearer(org.owner)).expect(409);
    const unpublished = await http()
      .post(`${base()}/${draft.body.id}/unpublish`)
      .set(bearer(org.owner))
      .expect(200);
    expect(unpublished.body.status).toBe('DRAFT');
  });

  it('uses optimistic locking and bumps the rules version', async () => {
    const t = await createTournament(app, org, {}, false);
    const first = await http()
      .patch(`${base()}/${t.id}`)
      .set(bearer(org.owner))
      .send({ version: t.version, rules: 'Updated rules v2' })
      .expect(200);
    expect(first.body.rulesVersion).toBe(2);
    const stale = await http()
      .patch(`${base()}/${t.id}`)
      .set(bearer(org.owner))
      .send({ version: t.version, name: 'Race' })
      .expect(409);
    expect(stale.body.code).toBe('STALE_VERSION');
  });

  it('locks competitive settings once teams have registered', async () => {
    const t = await createTournament(app, org);
    const captain = await registerUser(app);
    const team = await http()
      .post('/api/v1/teams')
      .set(bearer(captain))
      .send({ name: 'Locked In' })
      .expect(201);
    await prisma.registration.create({
      data: {
        organizationId: org.orgId,
        tournamentId: t.id,
        teamId: team.body.id,
        status: 'SUBMITTED',
        submittedById: captain.id,
      },
    });
    const current = await http().get(`${base()}/${t.id}`).set(bearer(org.owner)).expect(200);
    expect(current.body.lockedFields).toContain('teamSize');
    const res = await http()
      .patch(`${base()}/${t.id}`)
      .set(bearer(org.owner))
      .send({ version: current.body.version, teamSize: 5, prizeInfo: '$500' })
      .expect(409);
    expect(res.body).toMatchObject({ code: 'SETTINGS_LOCKED', fields: ['teamSize'] });
    await http()
      .patch(`${base()}/${t.id}`)
      .set(bearer(org.owner))
      .send({ version: current.body.version, prizeInfo: '$500' })
      .expect(200);
    await http()
      .patch(`${base()}/${t.id}`)
      .set(bearer(org.owner))
      .send({ version: current.body.version + 1, maxTeams: 2 })
      .expect(200);
    await http().post(`${base()}/${t.id}/unpublish`).set(bearer(org.owner)).expect(409);
  });

  it('clones configuration into a new draft (TOUR-07)', async () => {
    const t = await createTournament(app, org, { prizeInfo: 'Trophy' });
    const clone = await http()
      .post(`${base()}/${t.id}/clone`)
      .set(bearer(org.owner))
      .send({ name: 'Summer Cup' })
      .expect(201);
    expect(clone.body).toMatchObject({
      name: 'Summer Cup',
      status: 'DRAFT',
      prizeInfo: 'Trophy',
      teamSize: 2,
    });
    expect(clone.body.id).not.toBe(t.id);
  });

  it('cancels with a reason that is audited', async () => {
    const t = await createTournament(app, org);
    await http()
      .post(`${base()}/${t.id}/cancel`)
      .set(bearer(org.owner))
      .send({ reason: 'Venue issue' })
      .expect(200);
    const audit = await http()
      .get(`/api/v1/orgs/${org.orgId}/audit?entity=Tournament&entityId=${t.id}`)
      .set(bearer(org.owner))
      .expect(200);
    expect(audit.body.items[0]).toMatchObject({
      newValue: { status: 'CANCELLED' },
      reason: 'Venue issue',
    });
  });

  it('isolates tournaments between organizations and restricts writes by role', async () => {
    const t = await createTournament(app, org);
    const other = await createOrg(app, 'Other League');
    await http()
      .get(`/api/v1/orgs/${other.orgId}/tournaments/${t.id}`)
      .set(bearer(other.owner))
      .expect(404);
    await http()
      .get(`/api/v1/orgs/${org.orgId}/tournaments/${t.id}`)
      .set(bearer(other.owner))
      .expect(404);

    const viewer = await registerUser(app);
    const invite = await http()
      .post(`/api/v1/orgs/${org.orgId}/invites`)
      .set(bearer(org.owner))
      .send({ email: viewer.email, role: 'REFEREE' })
      .expect(201);
    await http()
      .post('/api/v1/invites/accept')
      .set(bearer(viewer))
      .send({ token: invite.body.token })
      .expect(200);
    await http().get(`${base()}/${t.id}`).set(bearer(viewer)).expect(200);
    await http()
      .post(`${base()}/${t.id}/cancel`)
      .set(bearer(viewer))
      .send({ reason: 'nope' })
      .expect(403);

    await http()
      .post(`${base()}/${t.id}/staff`)
      .set(bearer(org.owner))
      .send({ userId: viewer.id, role: 'REFEREE' })
      .expect(204);
    const staff = await http().get(`${base()}/${t.id}/staff`).set(bearer(viewer)).expect(200);
    expect(staff.body).toEqual([expect.objectContaining({ userId: viewer.id, role: 'REFEREE' })]);
    const outsider = await registerUser(app);
    await http()
      .post(`${base()}/${t.id}/staff`)
      .set(bearer(org.owner))
      .send({ userId: outsider.id, role: 'REFEREE' })
      .expect(422);
  });
});

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from './utils/app.js';
import {
  bearer,
  enableMfa,
  registerPrivilegedUser,
  registerUser,
  type TestUser,
} from './utils/auth.js';
import { resetDb } from './utils/db.js';

describe('organizations & RBAC (AUTH-03..05)', () => {
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

  async function createOrg(owner: TestUser, name = 'Northern Esports League') {
    const res = await http().post('/api/v1/orgs').set(bearer(owner)).send({ name }).expect(201);
    return res.body as { id: string; slug: string };
  }

  async function inviteAndJoin(
    owner: TestUser,
    orgId: string,
    role: string,
    mfa = false,
  ): Promise<TestUser> {
    let staff = await registerUser(app);
    if (mfa) staff = await enableMfa(app, staff);
    const invite = await http()
      .post(`/api/v1/orgs/${orgId}/invites`)
      .set(bearer(owner))
      .send({ email: staff.email, role })
      .expect(201);
    await http()
      .post('/api/v1/invites/accept')
      .set(bearer(staff))
      .send({ token: invite.body.token })
      .expect(200);
    return staff;
  }

  it('creates an isolated workspace with the creator as owner', async () => {
    const owner = await registerPrivilegedUser(app);
    const org = await createOrg(owner);
    expect(org.slug).toBe('northern-esports-league');
    const mine = await http().get('/api/v1/orgs').set(bearer(owner)).expect(200);
    expect(mine.body).toEqual([expect.objectContaining({ id: org.id, role: 'OWNER' })]);
  });

  it('hides organizations from non-members (tenant isolation)', async () => {
    const ownerA = await registerPrivilegedUser(app);
    const ownerB = await registerPrivilegedUser(app);
    const orgA = await createOrg(ownerA, 'Org A');
    await http().get(`/api/v1/orgs/${orgA.id}`).set(bearer(ownerB)).expect(404);
    await http().get(`/api/v1/orgs/${orgA.id}/members`).set(bearer(ownerB)).expect(404);
    await http()
      .patch(`/api/v1/orgs/${orgA.id}`)
      .set(bearer(ownerB))
      .send({ name: 'Hijacked' })
      .expect(404);
  });

  it('requires an MFA session for owner/admin actions (AUTH-02)', async () => {
    const owner = await registerUser(app);
    const org = await createOrg(owner);
    const res = await http()
      .patch(`/api/v1/orgs/${org.id}`)
      .set(bearer(owner))
      .send({ name: 'Renamed' })
      .expect(403);
    expect(res.body.code).toBe('MFA_ENROLMENT_REQUIRED');
    const upgraded = await enableMfa(app, owner);
    await http()
      .patch(`/api/v1/orgs/${org.id}`)
      .set(bearer(upgraded))
      .send({ name: 'Renamed' })
      .expect(200);
  });

  it('invites staff who accept with a matching account (AUTH-05)', async () => {
    const owner = await registerPrivilegedUser(app);
    const org = await createOrg(owner);
    const referee = await inviteAndJoin(owner, org.id, 'REFEREE');
    const members = await http()
      .get(`/api/v1/orgs/${org.id}/members`)
      .set(bearer(referee))
      .expect(200);
    expect(members.body.map((m: { role: string }) => m.role).sort()).toEqual(['OWNER', 'REFEREE']);
  });

  it('rejects invite tokens used by the wrong account or reused', async () => {
    const owner = await registerPrivilegedUser(app);
    const org = await createOrg(owner);
    const intended = await registerUser(app);
    const other = await registerUser(app);
    const invite = await http()
      .post(`/api/v1/orgs/${org.id}/invites`)
      .set(bearer(owner))
      .send({ email: intended.email, role: 'VIEWER' })
      .expect(201);
    await http()
      .post('/api/v1/invites/accept')
      .set(bearer(other))
      .send({ token: invite.body.token })
      .expect(403);
    await http()
      .post('/api/v1/invites/accept')
      .set(bearer(intended))
      .send({ token: invite.body.token })
      .expect(200);
    await http()
      .post('/api/v1/invites/accept')
      .set(bearer(intended))
      .send({ token: invite.body.token })
      .expect(410);
  });

  it('enforces role hierarchy (AUTH-04)', async () => {
    const owner = await registerPrivilegedUser(app);
    const org = await createOrg(owner);
    const viewer = await inviteAndJoin(owner, org.id, 'VIEWER');
    const admin = await inviteAndJoin(owner, org.id, 'ADMIN', true);

    await http()
      .patch(`/api/v1/orgs/${org.id}`)
      .set(bearer(viewer))
      .send({ name: 'Nope' })
      .expect(403);
    await http()
      .post(`/api/v1/orgs/${org.id}/invites`)
      .set(bearer(viewer))
      .send({ email: 'x@example.com', role: 'VIEWER' })
      .expect(403);
    // Admins can invite staff but not owners.
    await http()
      .post(`/api/v1/orgs/${org.id}/invites`)
      .set(bearer(admin))
      .send({ email: 'y@example.com', role: 'REFEREE' })
      .expect(201);
    await http()
      .post(`/api/v1/orgs/${org.id}/invites`)
      .set(bearer(admin))
      .send({ email: 'z@example.com', role: 'OWNER' })
      .expect(403);

    const members = await http()
      .get(`/api/v1/orgs/${org.id}/members`)
      .set(bearer(owner))
      .expect(200);
    const ownerMember = members.body.find((m: { role: string }) => m.role === 'OWNER');
    // Admins cannot remove owners, and the last owner cannot be demoted.
    await http()
      .delete(`/api/v1/orgs/${org.id}/members/${ownerMember.id}`)
      .set(bearer(admin))
      .expect(403);
    const demote = await http()
      .patch(`/api/v1/orgs/${org.id}/members/${ownerMember.id}`)
      .set(bearer(owner))
      .send({ role: 'ADMIN' })
      .expect(409);
    expect(demote.body.code).toBe('LAST_OWNER');
  });

  it('audit logs administrative changes with actor and request id', async () => {
    const owner = await registerPrivilegedUser(app);
    const org = await createOrg(owner);
    await http()
      .patch(`/api/v1/orgs/${org.id}`)
      .set(bearer(owner))
      .set('x-request-id', 'audit-req-0001')
      .send({ name: 'Renamed League' })
      .expect(200);
    const audit = await http().get(`/api/v1/orgs/${org.id}/audit`).set(bearer(owner)).expect(200);
    expect(audit.body.items[0]).toMatchObject({
      action: 'organization.renamed',
      actorId: owner.id,
      oldValue: { name: 'Northern Esports League' },
      newValue: { name: 'Renamed League' },
      requestId: 'audit-req-0001',
    });
    expect(audit.body.items[1].action).toBe('organization.created');
  });
});

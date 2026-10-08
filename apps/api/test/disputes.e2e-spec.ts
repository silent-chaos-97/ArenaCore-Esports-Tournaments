import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { bearer, registerUser, type TestUser } from './utils/auth.js';
import { resetDb } from './utils/db.js';
import {
  addStaff,
  createOrg,
  playMatch,
  startTournament,
  type OrgFixture,
  type StartedTournament,
} from './utils/fixtures.js';

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
]);

describe('dispute management (workflow D)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let org: OrgFixture;
  let referee: TestUser;
  const http = () => request(app.getHttpServer());
  const orgDisputes = () => `/api/v1/orgs/${org.orgId}/disputes`;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    prisma = await resetDb(app);
    org = await createOrg(app);
    referee = await addStaff(app, org, 'REFEREE');
  });
  afterAll(async () => {
    await app.close();
  });

  async function completedSemis(): Promise<{
    started: StartedTournament;
    matches: Awaited<ReturnType<StartedTournament['bracket']>>['matches'];
  }> {
    const started = await startTournament(app, org, 4);
    let { matches } = await started.bracket();
    await playMatch(app, started, matches['W1-1']!, 1, 0);
    await playMatch(app, started, matches['W1-2']!, 1, 0);
    ({ matches } = await started.bracket());
    return { started, matches };
  }

  it('freezes progression, lets a referee overturn the result and recalculates the bracket', async () => {
    const { started, matches } = await completedSemis();
    const semi = matches['W1-1']!;
    const loserCaptain = started.captainOf(semi.b!.registrationId);

    const opened = await http()
      .post(`/api/v1/matches/${semi.id}/disputes`)
      .set(bearer(loserCaptain))
      .send({
        reason: 'INCORRECT_RESULT',
        description: 'Opponent reported the wrong winner, we won 1-0.',
        evidence: [{ kind: 'MATCH_ID', text: 'EUW-998877' }],
      })
      .expect(201);
    expect(opened.body).toMatchObject({
      status: 'OPEN',
      openedBySlot: 'B',
      evidence: [expect.objectContaining({ kind: 'MATCH_ID' })],
    });
    expect((await prisma.match.findUniqueOrThrow({ where: { id: semi.id } })).status).toBe(
      'DISPUTED',
    );

    const final = matches['W2-1']!;
    const frozen = await http()
      .post(`/api/v1/matches/${final.id}/results`)
      .set(bearer(started.captainOf(final.a!.registrationId)))
      .send({ scoreA: 1, scoreB: 0 })
      .expect(409);
    expect(frozen.body.code).toBe('PROGRESSION_FROZEN');

    const id = opened.body.id;
    await http().post(`${orgDisputes()}/${id}/assign`).set(bearer(referee)).send({}).expect(200);
    await http().post(`${orgDisputes()}/${id}/investigate`).set(bearer(referee)).expect(200);
    const workspace = await http().get(`${orgDisputes()}/${id}`).set(bearer(referee)).expect(200);
    expect(workspace.body.match.results.length).toBeGreaterThanOrEqual(2);

    const resolved = await http()
      .post(`${orgDisputes()}/${id}/resolve`)
      .set(bearer(referee))
      .send({
        outcome: 'OVERTURN_RESULT',
        scoreA: 0,
        scoreB: 1,
        ruling: 'Game client data shows team B won the map.',
      })
      .expect(200);
    expect(resolved.body).toMatchObject({
      status: 'RESOLVED',
      decision: { outcome: 'OVERTURN_RESULT', winnerSlot: 'B' },
    });

    const after = await started.bracket();
    expect(after.matches['W1-1']).toMatchObject({ status: 'COMPLETED', winnerSlot: 'B' });
    expect(after.matches['W2-1']!.a!.registrationId).toBe(semi.b!.registrationId);
    expect(
      await prisma.auditLog.count({ where: { action: 'dispute.resolved', entityId: id } }),
    ).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { type: 'DisputeResolved' } })).toBe(1);
    // Progression is unfrozen.
    await playMatch(app, started, after.matches['W2-1']!, 1, 0);
    expect((await started.bracket()).status).toBe('COMPLETED');
  });

  it('upholds a result, restoring the match, and only the assigned referee or an admin may rule', async () => {
    const { started, matches } = await completedSemis();
    const semi = matches['W1-2']!;
    const opened = await http()
      .post(`/api/v1/matches/${semi.id}/disputes`)
      .set(bearer(started.captainOf(semi.b!.registrationId)))
      .send({ reason: 'RULE_VIOLATION', description: 'They used a banned character in game two.' })
      .expect(201);
    const dup = await http()
      .post(`/api/v1/matches/${semi.id}/disputes`)
      .set(bearer(started.captainOf(semi.a!.registrationId)))
      .send({ reason: 'RULE_VIOLATION', description: 'Second dispute for the same match.' })
      .expect(409);
    expect(dup.body.code).toBe('DISPUTE_EXISTS');

    const otherReferee = await addStaff(app, org, 'REFEREE');
    await http()
      .post(`${orgDisputes()}/${opened.body.id}/assign`)
      .set(bearer(org.owner))
      .send({ refereeUserId: referee.id })
      .expect(200);
    await http()
      .post(`${orgDisputes()}/${opened.body.id}/assign`)
      .set(bearer(otherReferee))
      .send({ refereeUserId: referee.id })
      .expect(403);
    await http()
      .post(`${orgDisputes()}/${opened.body.id}/resolve`)
      .set(bearer(otherReferee))
      .send({ outcome: 'UPHOLD_RESULT', ruling: 'Not my dispute to rule on.' })
      .expect(403);
    await http()
      .post(`${orgDisputes()}/${opened.body.id}/resolve`)
      .set(bearer(referee))
      .send({ outcome: 'UPHOLD_RESULT', ruling: 'Character was legal in this patch.' })
      .expect(200);
    expect((await prisma.match.findUniqueOrThrow({ where: { id: semi.id } })).status).toBe(
      'COMPLETED',
    );
  });

  it('resolves a reporting conflict by forfeit and supports replays', async () => {
    const started = await startTournament(app, org, 4);
    const { matches } = await started.bracket();
    const m = matches['W1-1']!;
    await http()
      .post(`/api/v1/matches/${m.id}/results`)
      .set(bearer(started.captainOf(m.a!.registrationId)))
      .send({ scoreA: 1, scoreB: 0 })
      .expect(200);
    await http()
      .post(`/api/v1/matches/${m.id}/results`)
      .set(bearer(started.captainOf(m.b!.registrationId)))
      .send({ scoreA: 0, scoreB: 1 })
      .expect(200);
    const dispute = await prisma.dispute.findFirstOrThrow({ where: { matchId: m.id } });

    await http()
      .post(`${orgDisputes()}/${dispute.id}/resolve`)
      .set(bearer(org.owner))
      .send({
        outcome: 'FORFEIT',
        winnerSlot: 'A',
        ruling: 'Team B submitted a doctored screenshot.',
      })
      .expect(200);
    expect((await started.bracket()).matches['W1-1']).toMatchObject({
      status: 'FORFEITED',
      winnerSlot: 'A',
    });

    // A replay on the other semifinal sends both teams back to play.
    const m2 = matches['W1-2']!;
    await playMatch(app, started, m2, 1, 0);
    const replayDispute = await http()
      .post(`/api/v1/matches/${m2.id}/disputes`)
      .set(bearer(started.captainOf(m2.b!.registrationId)))
      .send({
        reason: 'SERVER_FAILURE',
        description: 'Server crashed mid-game and the result was forced.',
      })
      .expect(201);
    await http()
      .post(`${orgDisputes()}/${replayDispute.body.id}/resolve`)
      .set(bearer(org.owner))
      .send({ outcome: 'REPLAY', ruling: 'Server failure confirmed; replay the match.' })
      .expect(200);
    const replayed = (await started.bracket()).matches;
    expect(replayed['W1-2']).toMatchObject({ status: 'READY', winnerSlot: null });
    expect(replayed['W2-1']!.b).toBeNull();
    await playMatch(app, started, replayed['W1-2']!, 0, 1);
    expect((await started.bracket()).matches['W2-1']!.b!.registrationId).toBe(m2.b!.registrationId);
  });

  it('lets the opener withdraw, restoring the original state', async () => {
    const { started, matches } = await completedSemis();
    const semi = matches['W1-1']!;
    const captain = started.captainOf(semi.b!.registrationId);
    const opened = await http()
      .post(`/api/v1/matches/${semi.id}/disputes`)
      .set(bearer(captain))
      .send({
        reason: 'DISCONNECT',
        description: 'We disconnected but on reflection it was our fault.',
      })
      .expect(201);
    await http()
      .post(`/api/v1/disputes/${opened.body.id}/withdraw`)
      .set(bearer(started.captainOf(semi.a!.registrationId)))
      .expect(403);
    const withdrawn = await http()
      .post(`/api/v1/disputes/${opened.body.id}/withdraw`)
      .set(bearer(captain))
      .expect(200);
    expect(withdrawn.body.status).toBe('WITHDRAWN');
    expect((await prisma.match.findUniqueOrThrow({ where: { id: semi.id } })).status).toBe(
      'COMPLETED',
    );
  });

  it('accepts verified file evidence via presigned uploads and rejects spoofed files', async () => {
    const { started, matches } = await completedSemis();
    const semi = matches['W1-1']!;
    const captain = started.captainOf(semi.b!.registrationId);
    const opened = await http()
      .post(`/api/v1/matches/${semi.id}/disputes`)
      .set(bearer(captain))
      .send({
        reason: 'INCORRECT_RESULT',
        description: 'Screenshot attached shows the real score.',
      })
      .expect(201);
    const id = opened.body.id;

    async function upload(bytes: Buffer, contentType = 'image/png') {
      const slot = await http()
        .post(`/api/v1/disputes/${id}/evidence/upload-url`)
        .set(bearer(captain))
        .send({ kind: 'SCREENSHOT', contentType, sizeBytes: bytes.length })
        .expect(200);
      const put = await fetch(slot.body.uploadUrl, {
        method: 'PUT',
        body: bytes,
        headers: { 'content-type': contentType },
      });
      expect(put.ok).toBe(true);
      return slot.body.storageKey as string;
    }

    const goodKey = await upload(PNG);
    const attached = await http()
      .post(`/api/v1/disputes/${id}/evidence`)
      .set(bearer(captain))
      .send({ kind: 'SCREENSHOT', storageKey: goodKey })
      .expect(201);
    const file = attached.body.evidence.find(
      (e: { storageKey: string }) => e.storageKey === goodKey,
    );
    expect(file).toMatchObject({ contentType: 'image/png', sizeBytes: PNG.length });

    const download = await http()
      .get(`/api/v1/disputes/${id}/evidence/${file.id}/download`)
      .set(bearer(referee))
      .expect(200);
    const fetched = await fetch(download.body.url);
    expect(Buffer.from(await fetched.arrayBuffer()).equals(PNG)).toBe(true);

    const spoofKey = await upload(Buffer.from('MZ\u0090\u0000 not really a png'));
    const spoof = await http()
      .post(`/api/v1/disputes/${id}/evidence`)
      .set(bearer(captain))
      .send({ kind: 'SCREENSHOT', storageKey: spoofKey })
      .expect(422);
    expect(spoof.body.code).toBe('INVALID_EVIDENCE');
    await http()
      .post(`/api/v1/disputes/${id}/evidence`)
      .set(bearer(captain))
      .send({ kind: 'SCREENSHOT', storageKey: 'disputes/someone-else/file.png' })
      .expect(422);

    const outsider = await registerUser(app);
    await http().get(`/api/v1/disputes/${id}`).set(bearer(outsider)).expect(404);
    await http()
      .post(`/api/v1/disputes/${id}/evidence/upload-url`)
      .set(bearer(captain))
      .send({ kind: 'SCREENSHOT', contentType: 'application/x-msdownload', sizeBytes: 10 })
      .expect(400);
  });
});

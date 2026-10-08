import type { INestApplication } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { MatchesService } from '../src/modules/matches/matches.service.js';
import { createTestApp } from './utils/app.js';
import { bearer, registerUser } from './utils/auth.js';
import { resetDb } from './utils/db.js';
import { createOrg, playMatch, startTournament, type OrgFixture } from './utils/fixtures.js';

const SECRET = 'dev-game-webhook-secret';
const sign = (body: string) => `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;

describe('matches & results', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let org: OrgFixture;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    process.env.GAME_WEBHOOK_SECRET = SECRET;
    app = await createTestApp();
  });
  beforeEach(async () => {
    prisma = await resetDb(app);
    org = await createOrg(app);
  });
  afterAll(async () => {
    await app.close();
  });

  it('confirms matching captain reports and advances the winner atomically', async () => {
    const started = await startTournament(app, org, 4);
    let { matches } = await started.bracket();
    const m = matches['W1-1']!;
    expect(m.status).toBe('READY');

    const first = await http()
      .post(`/api/v1/matches/${m.id}/results`)
      .set(bearer(started.captainOf(m.a!.registrationId)))
      .send({
        scoreA: 1,
        scoreB: 0,
        evidence: [{ kind: 'SCREENSHOT', url: 'https://img.example.com/1.png' }],
      })
      .expect(200);
    expect(first.body.status).toBe('RESULT_PENDING');

    const confirmed = await http()
      .post(`/api/v1/matches/${m.id}/results`)
      .set(bearer(started.captainOf(m.b!.registrationId)))
      .send({ scoreA: 1, scoreB: 0 })
      .expect(200);
    expect(confirmed.body).toMatchObject({
      status: 'COMPLETED',
      winnerSlot: 'A',
      scoreA: 1,
      scoreB: 0,
    });

    ({ matches } = await started.bracket());
    expect(matches['W2-1']!.a!.registrationId).toBe(m.a!.registrationId);
    expect(matches['W2-1']!.status).toBe('PENDING');
    expect(await prisma.outboxEvent.count({ where: { type: 'MatchCompleted' } })).toBe(1);
    const loser = await prisma.standing.findUniqueOrThrow({
      where: { registrationId: m.b!.registrationId },
    });
    expect(loser).toMatchObject({ losses: 1, placement: 3 });
  });

  it('treats a repeated report as a no-op and validates scores and reporters', async () => {
    const started = await startTournament(app, org, 2, { bestOf: 3 });
    const m = (await started.bracket()).matches['W1-1']!;
    const captainA = started.captainOf(m.a!.registrationId);
    for (let i = 0; i < 2; i++) {
      await http()
        .post(`/api/v1/matches/${m.id}/results`)
        .set(bearer(captainA))
        .send({ scoreA: 2, scoreB: 1 })
        .expect(200);
    }
    expect(await prisma.matchResult.count({ where: { matchId: m.id } })).toBe(1);

    const invalid = await http()
      .post(`/api/v1/matches/${m.id}/results`)
      .set(bearer(captainA))
      .send({ scoreA: 1, scoreB: 1 })
      .expect(422);
    expect(invalid.body.code).toBe('INVALID_SCORE');
    const outsider = await registerUser(app);
    await http()
      .post(`/api/v1/matches/${m.id}/results`)
      .set(bearer(outsider))
      .send({ scoreA: 2, scoreB: 0 })
      .expect(403);
  });

  it('opens a dispute automatically when reports conflict', async () => {
    const started = await startTournament(app, org, 2);
    const m = (await started.bracket()).matches['W1-1']!;
    await http()
      .post(`/api/v1/matches/${m.id}/results`)
      .set(bearer(started.captainOf(m.a!.registrationId)))
      .send({ scoreA: 1, scoreB: 0 })
      .expect(200);
    const res = await http()
      .post(`/api/v1/matches/${m.id}/results`)
      .set(bearer(started.captainOf(m.b!.registrationId)))
      .send({ scoreA: 0, scoreB: 1 })
      .expect(200);
    expect(res.body.status).toBe('DISPUTED');
    const dispute = await prisma.dispute.findFirstOrThrow({ where: { matchId: m.id } });
    expect(dispute).toMatchObject({ status: 'OPEN', reason: 'INCORRECT_RESULT' });
    expect(await prisma.matchResult.count({ where: { matchId: m.id, status: 'CONFLICTED' } })).toBe(
      2,
    );
  });

  it('lets referees override a result, re-routing downstream matches with an audit trail', async () => {
    const started = await startTournament(app, org, 4);
    let { matches } = await started.bracket();
    const m = matches['W1-1']!;
    await playMatch(app, started, m, 1, 0);
    ({ matches } = await started.bracket());
    expect(matches['W2-1']!.a!.registrationId).toBe(m.a!.registrationId);

    const url = `/api/v1/orgs/${org.orgId}/matches/${m.id}/result`;
    const blocked = await http()
      .post(url)
      .set(bearer(org.owner))
      .send({ scoreA: 0, scoreB: 1, reason: 'Wrong winner reported' })
      .expect(409);
    expect(blocked.body.code).toBe('RESULT_EXISTS');
    const overridden = await http()
      .post(url)
      .set(bearer(org.owner))
      .send({ scoreA: 0, scoreB: 1, override: true, reason: 'Wrong winner reported' })
      .expect(200);
    expect(overridden.body).toMatchObject({ status: 'COMPLETED', winnerSlot: 'B' });

    ({ matches } = await started.bracket());
    expect(matches['W2-1']!.a!.registrationId).toBe(m.b!.registrationId);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'match.result_set', entityId: m.id },
    });
    expect(audit).toMatchObject({ reason: 'Wrong winner reported', oldValue: { winnerSlot: 'A' } });
    expect(await prisma.matchResult.count({ where: { matchId: m.id, status: 'SUPERSEDED' } })).toBe(
      2,
    );
  });

  it('awards forfeits after a no-show review', async () => {
    const started = await startTournament(app, org, 2, {
      matchCheckInMinutes: 15,
      registrationClosesAt: new Date(Date.now() + 60_000).toISOString(),
      startsAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
    const m = (await started.bracket()).matches['W1-1']!;
    expect(m.status).toBe('SCHEDULED');
    // Only side A checks in.
    const checked = await http()
      .post(`/api/v1/matches/${m.id}/check-in`)
      .set(bearer(started.captainOf(m.a!.registrationId)))
      .expect(200);
    expect(checked.body.status).toBe('CHECK_IN_OPEN');
    expect(checked.body.a.checkedIn).toBe(true);

    const tick = await app.get(MatchesService).runCheckInTick(new Date(Date.now() + 10 * 60_000));
    expect(tick.expired).toBe(1);
    const reviewed = await prisma.match.findUniqueOrThrow({ where: { id: m.id } });
    expect(reviewed.status).toBe('NO_SHOW_REVIEW');
    expect(await prisma.outboxEvent.count({ where: { type: 'CheckInExpired' } })).toBe(1);

    const forfeit = await http()
      .post(`/api/v1/orgs/${org.orgId}/matches/${m.id}/result`)
      .set(bearer(org.owner))
      .send({ forfeitBy: 'B', reason: 'No-show' })
      .expect(200);
    expect(forfeit.body).toMatchObject({ status: 'FORFEITED', winnerSlot: 'A' });
    expect((await started.bracket()).status).toBe('COMPLETED');
  });

  it('marks a match READY once both teams check in', async () => {
    const started = await startTournament(app, org, 2, {
      matchCheckInMinutes: 15,
      registrationClosesAt: new Date(Date.now() + 60_000).toISOString(),
      startsAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
    const m = (await started.bracket()).matches['W1-1']!;
    await http()
      .post(`/api/v1/matches/${m.id}/check-in`)
      .set(bearer(started.captainOf(m.a!.registrationId)))
      .expect(200);
    const ready = await http()
      .post(`/api/v1/matches/${m.id}/check-in`)
      .set(bearer(started.captainOf(m.b!.registrationId)))
      .expect(200);
    expect(ready.body.status).toBe('READY');
    expect(await prisma.outboxEvent.count({ where: { type: 'OpponentCheckedIn' } })).toBe(2);
  });

  it('ingests signed game webhooks idempotently and freezes progression on contradictions', async () => {
    const started = await startTournament(app, org, 4);
    let { matches } = await started.bracket();
    await http()
      .patch(`/api/v1/orgs/${org.orgId}/matches/${matches['W1-1']!.id}/lobby`)
      .set(bearer(org.owner))
      .send({ externalMatchId: 'EUW-123' })
      .expect(200);

    const body = JSON.stringify({
      eventId: 'evt-1',
      externalMatchId: 'EUW-123',
      scoreA: 1,
      scoreB: 0,
    });
    const post = (payload: string, signature: string) =>
      http()
        .post('/api/v1/webhooks/games/generic/match-result')
        .set('content-type', 'application/json')
        .set('x-arenacore-signature', signature)
        .send(payload);

    await post(body, 'sha256=deadbeef').expect(401);
    const results = await Promise.all([
      post(body, sign(body)),
      post(body, sign(body)),
      post(body, sign(body)),
    ]);
    expect(results.map((r) => r.status)).toEqual([202, 202, 202]);
    expect(results.map((r) => r.body.status).sort()).toEqual(['applied', 'duplicate', 'duplicate']);
    expect(await prisma.matchResult.count({ where: { source: 'GAME_API' } })).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { type: 'MatchCompleted' } })).toBe(1);

    await playMatch(app, started, matches['W1-2']!, 1, 0);
    ({ matches } = await started.bracket());
    expect(matches['W2-1']!.status).toBe('READY');

    // A contradicting callback for W1-1 disputes it and freezes the final.
    const contra = JSON.stringify({
      eventId: 'evt-2',
      externalMatchId: 'EUW-123',
      scoreA: 0,
      scoreB: 1,
    });
    const disputed = await post(contra, sign(contra)).expect(202);
    expect(disputed.body.status).toBe('disputed');
    const final = matches['W2-1']!;
    const frozen = await http()
      .post(`/api/v1/matches/${final.id}/results`)
      .set(bearer(started.captainOf(final.a!.registrationId)))
      .send({ scoreA: 1, scoreB: 0 })
      .expect(409);
    expect(frozen.body.code).toBe('PROGRESSION_FROZEN');
  });

  it('runs a whole single-elimination event to a champion with final standings', async () => {
    const started = await startTournament(app, org, 4);
    let { matches } = await started.bracket();
    await playMatch(app, started, matches['W1-1']!, 1, 0);
    await playMatch(app, started, matches['W1-2']!, 0, 1);
    ({ matches } = await started.bracket());
    await playMatch(app, started, matches['W2-1']!, 1, 0);
    const finished = await started.bracket();
    expect(finished.status).toBe('COMPLETED');

    const standings = await prisma.standing.findMany({
      where: { tournamentId: started.tournamentId },
      orderBy: { placement: 'asc' },
    });
    expect(standings.map((s) => s.placement)).toEqual([1, 2, 3, 3]);
    expect(standings[0]!.registrationId).toBe(matches['W2-1']!.a!.registrationId);
    expect(await prisma.outboxEvent.count({ where: { type: 'TournamentCompleted' } })).toBe(1);
  });
});

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { OutboxRelay } from '../src/modules/events/outbox-relay.js';
import { SchedulerService } from '../src/modules/events/scheduler.service.js';
import { NotificationsService } from '../src/modules/notifications/notifications.service.js';
import { createTestApp } from './utils/app.js';
import { bearer } from './utils/auth.js';
import { resetDb } from './utils/db.js';
import {
  approvedTeams,
  createOrg,
  createTournament,
  playMatch,
  startTournament,
  type OrgFixture,
} from './utils/fixtures.js';

const MAILPIT = 'http://localhost:8025/api/v1';

async function mailsTo(email: string): Promise<{ Subject: string }[]> {
  const res = await fetch(`${MAILPIT}/search?query=${encodeURIComponent(`to:${email}`)}`);
  return ((await res.json()) as { messages: { Subject: string }[] }).messages;
}

describe('events & notifications', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let org: OrgFixture;
  let relay: OutboxRelay;
  let notifications: NotificationsService;
  const http = () => request(app.getHttpServer());

  /** Inline stand-in for the worker: relay → dispatch → email. */
  async function drain(): Promise<void> {
    while ((await relay.relayOnce()) > 0);
  }

  beforeAll(async () => {
    app = await createTestApp();
    relay = app.get(OutboxRelay);
    notifications = app.get(NotificationsService);
    relay.addSink(async (event) => {
      const { emailDeliveryIds } = await notifications.dispatch(event);
      for (const id of emailDeliveryIds) await notifications.deliverEmail(id);
    });
  });
  beforeEach(async () => {
    prisma = await resetDb(app);
    org = await createOrg(app);
  });
  afterAll(async () => {
    await app.close();
  });

  it('notifies teams in-app and by email when their registration is approved', async () => {
    const t = await createTournament(app, org, { name: 'Notify Cup' });
    const [team] = await approvedTeams(app, org, t.id, 1, { size: 2 });
    await drain();

    const inbox = await http().get('/api/v1/notifications').set(bearer(team!.captain)).expect(200);
    const approval = inbox.body.items.find(
      (n: { type: string }) => n.type === 'REGISTRATION_APPROVED',
    );
    expect(approval).toMatchObject({ title: 'Registration approved', readAt: null });
    expect(approval.body).toContain('Notify Cup');
    // The invited teammate got a team invite notification too.
    const mate = await http()
      .get('/api/v1/notifications')
      .set(bearer(team!.players[0]!))
      .expect(200);
    expect(mate.body.items.map((n: { type: string }) => n.type)).toEqual(
      expect.arrayContaining(['TEAM_INVITE', 'REGISTRATION_APPROVED']),
    );

    const mails = await mailsTo(team!.captain.email);
    expect(mails.map((m) => m.Subject)).toContain('[ArenaCore] Registration approved');
    expect(await prisma.outboxEvent.count({ where: { processedAt: null } })).toBe(0);
  });

  it('never notifies twice when an event is relayed again', async () => {
    const t = await createTournament(app, org);
    const [team] = await approvedTeams(app, org, t.id, 1);
    await drain();
    const before = await prisma.notification.count();
    await prisma.outboxEvent.updateMany({ data: { processedAt: null } });
    await drain();
    expect(await prisma.notification.count()).toBe(before);
    expect(
      await prisma.notificationDelivery.count({ where: { channel: 'EMAIL', status: 'SENT' } }),
    ).toBe(await prisma.notificationDelivery.count({ where: { channel: 'EMAIL' } }));
    void team;
  });

  it('covers the match lifecycle: next match, result, advancement and elimination', async () => {
    const started = await startTournament(app, org, 4);
    const { matches } = await started.bracket();
    const semi = matches['W1-1']!;
    await playMatch(app, started, semi, 1, 0);
    await drain();
    const winner = await http()
      .get('/api/v1/notifications')
      .set(bearer(started.captainOf(semi.a!.registrationId)))
      .expect(200);
    const loser = await http()
      .get('/api/v1/notifications')
      .set(bearer(started.captainOf(semi.b!.registrationId)))
      .expect(200);
    const types = (body: { items: { type: string }[] }) => body.items.map((n) => n.type);
    expect(types(winner.body)).toEqual(
      expect.arrayContaining(['MATCH_STARTING_SOON', 'RESULT_CONFIRMED', 'ADVANCED']),
    );
    expect(types(loser.body)).toEqual(expect.arrayContaining(['RESULT_CONFIRMED', 'ELIMINATED']));
    expect(loser.body.items.find((n: { type: string }) => n.type === 'ELIMINATED').body).toContain(
      'place 3',
    );
  });

  it('marks notifications as read individually and in bulk', async () => {
    const t = await createTournament(app, org);
    const [team] = await approvedTeams(app, org, t.id, 1);
    await drain();
    const inbox = await http().get('/api/v1/notifications').set(bearer(team!.captain)).expect(200);
    expect(inbox.body.unread).toBeGreaterThan(0);
    const first = inbox.body.items[0];
    const read = await http()
      .post(`/api/v1/notifications/${first.id}/read`)
      .set(bearer(team!.captain))
      .expect(200);
    expect(read.body.readAt).not.toBeNull();
    await http()
      .post(`/api/v1/notifications/${first.id}/read`)
      .set(bearer(team!.players[0]!))
      .expect(404);
    await http().post('/api/v1/notifications/read-all').set(bearer(team!.captain)).expect(200);
    const unread = await http()
      .get('/api/v1/notifications?unreadOnly=true')
      .set(bearer(team!.captain))
      .expect(200);
    expect(unread.body).toMatchObject({ items: [], unread: 0 });
  });

  it('scheduler announces matches starting soon exactly once per scheduled time', async () => {
    const started = await startTournament(app, org, 2, {
      matchCheckInMinutes: 10,
      registrationClosesAt: new Date(Date.now() + 60_000).toISOString(),
      startsAt: new Date(Date.now() + 12 * 60_000).toISOString(),
    });
    const scheduler = app.get(SchedulerService);
    const now = Date.now();
    const early = await scheduler.tick(new Date(now));
    expect(early).toMatchObject({ startingSoon: 1, opened: 0 });
    // Three minutes later the 10-minute check-in window has opened; no second reminder.
    const later = await scheduler.tick(new Date(now + 3 * 60_000));
    expect(later).toMatchObject({ startingSoon: 0, opened: 1 });
    await drain();
    const m = (await started.bracket()).matches['W1-1']!;
    const inbox = await http()
      .get('/api/v1/notifications')
      .set(bearer(started.captainOf(m.a!.registrationId)))
      .expect(200);
    expect(inbox.body.items.map((n: { type: string }) => n.type)).toEqual(
      expect.arrayContaining(['CHECK_IN_OPENED', 'MATCH_STARTING_SOON']),
    );
  });
});

import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OutboxRelay } from '../src/modules/events/outbox-relay.js';
import { NotificationsService } from '../src/modules/notifications/notifications.service.js';
import { RealtimeService } from '../src/modules/realtime/realtime.service.js';
import { createTestApp } from './utils/app.js';
import { bearer } from './utils/auth.js';
import { resetDb } from './utils/db.js';
import {
  createOrg,
  createTournament,
  playMatch,
  startTournament,
  type OrgFixture,
} from './utils/fixtures.js';

/** Minimal SSE client: collects events until `until` matches or the timeout elapses. */
async function collect(
  url: string,
  trigger: () => Promise<void>,
  until: (events: { event: string; data: unknown }[]) => boolean,
  timeoutMs = 5000,
) {
  const controller = new AbortController();
  const res = await fetch(url, {
    signal: controller.signal,
    headers: { accept: 'text/event-stream' },
  });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: { event: string; data: unknown }[] = [];
  let buffer = '';
  const deadline = Date.now() + timeoutMs;
  await trigger();
  try {
    while (!until(events) && Date.now() < deadline) {
      const chunk = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value: undefined }>((r) =>
          setTimeout(() => r({ done: true, value: undefined }), deadline - Date.now()),
        ),
      ]);
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const event = /^event: (.*)$/m.exec(frame)?.[1] ?? 'message';
        const data = /^data: (.*)$/m.exec(frame)?.[1];
        if (data) events.push({ event, data: JSON.parse(data) });
      }
    }
  } finally {
    controller.abort();
  }
  return events;
}

describe('real-time streams (SSE)', () => {
  let app: INestApplication;
  let base: string;
  let org: OrgFixture;
  let relay: OutboxRelay;

  beforeAll(async () => {
    app = await createTestApp();
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
    relay = app.get(OutboxRelay);
    const realtime = app.get(RealtimeService);
    const notifications = app.get(NotificationsService);
    // Same wiring as the worker process.
    relay.addSink((event) => realtime.publishEvent(event));
    relay.addSink(async (event) => void (await notifications.dispatch(event)));
    notifications.onCreated((n) => realtime.publishNotification(n));
    await realtime.ready();
  });
  beforeEach(async () => {
    await resetDb(app);
    org = await createOrg(app);
  });
  afterAll(async () => {
    await app.close();
  });

  const drain = async () => {
    while ((await relay.relayOnce()) > 0);
  };

  it('pushes bracket changes to spectators within the propagation budget', async () => {
    const started = await startTournament(app, org, 4);
    await drain();
    const { matches } = await started.bracket();
    const startedAt = Date.now();
    const events = await collect(
      `${base}/tournaments/${started.tournamentId}/stream`,
      async () => {
        await playMatch(app, started, matches['W1-1']!, 1, 0);
        await drain();
      },
      (evts) => ['MatchCompleted', 'TeamAdvanced'].every((t) => evts.some((e) => e.event === t)),
    );
    const completed = events.find((e) => e.event === 'MatchCompleted');
    expect(completed?.data).toMatchObject({
      tournamentId: started.tournamentId,
      matchId: matches['W1-1']!.id,
    });
    expect(events.map((e) => e.event)).toContain('TeamAdvanced');
    expect(Date.now() - startedAt).toBeLessThan(5000);
  });

  it('streams a user their own notifications only', async () => {
    const started = await startTournament(app, org, 2);
    await drain();
    const { matches } = await started.bracket();
    const m = matches['W1-1']!;
    const captainA = started.captainOf(m.a!.registrationId);
    const events = await collect(
      `${base}/me/stream?access_token=${captainA.token}`,
      async () => {
        await request(app.getHttpServer())
          .post(`/api/v1/matches/${m.id}/results`)
          .set(bearer(started.captainOf(m.b!.registrationId)))
          .send({ scoreA: 1, scoreB: 0 })
          .expect(200);
        await drain();
      },
      (evts) => evts.some((e) => e.event === 'notification'),
    );
    const note = events.find((e) => e.event === 'notification')!.data as { title: string };
    expect(note.title).toBe('Score reported');
  });

  it('requires a token for the private stream and hides draft tournaments', async () => {
    expect((await fetch(`${base}/me/stream`)).status).toBe(401);
    const draft = await createTournament(app, org, {}, false);
    // Repeat: the rejection used to race the SSE headers and occasionally return 200.
    for (let i = 0; i < 10; i++) {
      expect((await fetch(`${base}/tournaments/${draft.id}/stream`)).status).toBe(404);
    }
    expect(
      (await fetch(`${base}/tournaments/00000000-0000-4000-8000-000000000000/stream`)).status,
    ).toBe(404);
  });
});

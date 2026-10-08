import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { bearer, registerUser, type TestUser } from './utils/auth.js';
import { resetDb } from './utils/db.js';

describe('players & teams', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    prisma = await resetDb(app);
  });
  afterAll(async () => {
    await app.close();
  });

  async function gameId(slug = 'valorant'): Promise<string> {
    return (await prisma.game.findUniqueOrThrow({ where: { slug } })).id;
  }

  async function invitePlayer(captain: TestUser, teamId: string, role = 'PLAYER') {
    const player = await registerUser(app);
    const invite = await http()
      .post(`/api/v1/teams/${teamId}/invites`)
      .set(bearer(captain))
      .send({ email: player.email, role })
      .expect(201);
    return { player, inviteId: invite.body.id as string };
  }

  it('lists the public game catalog', async () => {
    const res = await http().get('/api/v1/games').expect(200);
    expect(res.body.map((g: { slug: string }) => g.slug)).toContain('valorant');
  });

  it('updates the player profile and links one identity per game', async () => {
    const user = await registerUser(app);
    await http()
      .patch('/api/v1/players/me')
      .set(bearer(user))
      .send({ country: 'se', dateOfBirth: '2001-05-04' })
      .expect(200);
    const linked = await http()
      .post('/api/v1/players/me/game-accounts')
      .set(bearer(user))
      .send({ gameId: await gameId(), externalPlayerId: 'Ace#EUW', username: 'Ace' })
      .expect(201);
    expect(linked.body.verificationStatus).toBe('UNVERIFIED');

    const me = await http().get('/api/v1/players/me').set(bearer(user)).expect(200);
    expect(me.body).toMatchObject({ country: 'SE', dateOfBirth: '2001-05-04' });
    expect(me.body.gameAccounts).toHaveLength(1);

    const pub = await http().get(`/api/v1/players/${me.body.id}`).expect(200);
    expect(pub.body.dateOfBirth).toBeUndefined();
  });

  it('prevents a game identity from being claimed by two players', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const body = { gameId: await gameId(), externalPlayerId: 'Shared#1', username: 'Shared' };
    await http().post('/api/v1/players/me/game-accounts').set(bearer(a)).send(body).expect(201);
    const res = await http()
      .post('/api/v1/players/me/game-accounts')
      .set(bearer(b))
      .send(body)
      .expect(409);
    expect(res.body.code).toBe('GAME_ACCOUNT_CLAIMED');
  });

  it('creates a team with the creator as captain and manages invitations', async () => {
    const captain = await registerUser(app);
    const team = await http()
      .post('/api/v1/teams')
      .set(bearer(captain))
      .send({ name: 'Midnight Wolves', tag: 'mw' })
      .expect(201);
    expect(team.body).toMatchObject({ slug: 'midnight-wolves', tag: 'MW' });
    expect(team.body.members).toEqual([expect.objectContaining({ role: 'CAPTAIN' })]);

    const { player, inviteId } = await invitePlayer(captain, team.body.id, 'SUBSTITUTE');
    const pending = await http()
      .get('/api/v1/players/me/team-invites')
      .set(bearer(player))
      .expect(200);
    expect(pending.body).toEqual([
      expect.objectContaining({ id: inviteId, teamName: 'Midnight Wolves' }),
    ]);

    const joined = await http()
      .post(`/api/v1/team-invites/${inviteId}/accept`)
      .set(bearer(player))
      .expect(200);
    expect(joined.body.members.map((m: { role: string }) => m.role)).toEqual([
      'CAPTAIN',
      'SUBSTITUTE',
    ]);
    await http().post(`/api/v1/team-invites/${inviteId}/accept`).set(bearer(player)).expect(410);

    const event = await prisma.outboxEvent.findFirst({ where: { type: 'TeamInviteCreated' } });
    expect(event?.payload).toMatchObject({ inviteId });
  });

  it('restricts team management to captain/manager', async () => {
    const captain = await registerUser(app);
    const team = await http()
      .post('/api/v1/teams')
      .set(bearer(captain))
      .send({ name: 'Iron Pandas' })
      .expect(201);
    const { player, inviteId } = await invitePlayer(captain, team.body.id);
    await http().post(`/api/v1/team-invites/${inviteId}/accept`).set(bearer(player)).expect(200);

    await http()
      .patch(`/api/v1/teams/${team.body.id}`)
      .set(bearer(player))
      .send({ name: 'Mine now' })
      .expect(403);
    await http()
      .post(`/api/v1/teams/${team.body.id}/invites`)
      .set(bearer(player))
      .send({ email: 'x@example.com' })
      .expect(403);
  });

  it('transfers captaincy, toggles active status and lets members leave', async () => {
    const captain = await registerUser(app);
    const team = await http()
      .post('/api/v1/teams')
      .set(bearer(captain))
      .send({ name: 'Solar Flare' })
      .expect(201);
    const { player, inviteId } = await invitePlayer(captain, team.body.id);
    const joined = await http()
      .post(`/api/v1/team-invites/${inviteId}/accept`)
      .set(bearer(player))
      .expect(200);
    const [captainMember, playerMember] = joined.body.members;

    // Captain cannot leave or be demoted without a replacement.
    await http()
      .delete(`/api/v1/teams/${team.body.id}/members/${captainMember.id}`)
      .set(bearer(captain))
      .expect(409);

    const benched = await http()
      .patch(`/api/v1/teams/${team.body.id}/members/${playerMember.id}`)
      .set(bearer(captain))
      .send({ active: false })
      .expect(200);
    expect(benched.body.members[1].active).toBe(false);

    const transferred = await http()
      .patch(`/api/v1/teams/${team.body.id}/members/${playerMember.id}`)
      .set(bearer(captain))
      .send({ role: 'CAPTAIN', active: true })
      .expect(200);
    expect(transferred.body.captainId).toBe(playerMember.playerId);
    expect(
      transferred.body.members.find((m: { id: string }) => m.id === captainMember.id).role,
    ).toBe('PLAYER');

    // The former captain can now leave.
    await http()
      .delete(`/api/v1/teams/${team.body.id}/members/${captainMember.id}`)
      .set(bearer(captain))
      .expect(204);
    const after = await http().get(`/api/v1/teams/${team.body.id}`).expect(200);
    expect(after.body.members).toHaveLength(1);
  });
});

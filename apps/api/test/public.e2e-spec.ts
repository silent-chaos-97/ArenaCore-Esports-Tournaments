import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CacheService } from '../src/infra/cache/cache.service.js';
import { createTestApp } from './utils/app.js';
import { resetDb } from './utils/db.js';
import {
  approvedTeams,
  createOrg,
  createTournament,
  playMatch,
  startTournament,
  type OrgFixture,
} from './utils/fixtures.js';

describe('public read API', () => {
  let app: INestApplication;
  let org: OrgFixture;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await resetDb(app);
    org = await createOrg(app, 'Nordic Arena');
  });
  afterAll(async () => {
    await app.close();
  });

  it('discovers published tournaments with prefix full-text search and filters', async () => {
    await createTournament(app, org, {
      name: 'Valorant Spring Showdown',
      description: 'Open qualifier',
    });
    await createTournament(app, org, { name: 'Autumn Brawl', region: 'NA' });
    await createTournament(app, org, { name: 'Secret Spring Draft' }, false);

    const all = await http().get('/api/v1/public/tournaments').expect(200);
    expect(all.body.items.map((t: { name: string }) => t.name).sort()).toEqual([
      'Autumn Brawl',
      'Valorant Spring Showdown',
    ]);

    const search = await http().get('/api/v1/public/tournaments?q=spri').expect(200);
    expect(search.body.items.map((t: { name: string }) => t.name)).toEqual([
      'Valorant Spring Showdown',
    ]);
    const byDescription = await http().get('/api/v1/public/tournaments?q=qualifier').expect(200);
    expect(byDescription.body.items).toHaveLength(1);

    const na = await http().get('/api/v1/public/tournaments?region=na').expect(200);
    expect(na.body.items.map((t: { name: string }) => t.name)).toEqual(['Autumn Brawl']);
    const live = await http().get('/api/v1/public/tournaments?phase=live').expect(200);
    expect(live.body.items).toEqual([]);
    expect(all.body.items[0]).toMatchObject({
      organizationName: 'Nordic Arena',
      gameSlug: 'valorant',
    });
  });

  it('exposes tournament detail and entered teams but hides drafts', async () => {
    const t = await createTournament(app, org, { name: 'Detail Cup', maxTeams: 4 });
    await approvedTeams(app, org, t.id, 2);
    const detail = await http().get(`/api/v1/public/tournaments/${t.slug}`).expect(200);
    expect(detail.body).toMatchObject({
      name: 'Detail Cup',
      registeredTeams: 2,
      registrationOpen: true,
      maxTeams: 4,
    });
    const teams = await http().get(`/api/v1/public/tournaments/${t.slug}/teams`).expect(200);
    expect(teams.body).toHaveLength(2);

    const draft = await createTournament(app, org, { name: 'Hidden Draft' }, false);
    await http().get(`/api/v1/public/tournaments/${draft.slug}`).expect(404);
  });

  it('serves bracket, schedule, results, standings, team history and the org leaderboard', async () => {
    const started = await startTournament(app, org, 4, { name: 'Public Finals' });
    const slug = 'public-finals';
    let { matches } = await started.bracket();
    await playMatch(app, started, matches['W1-1']!, 1, 0);
    await playMatch(app, started, matches['W1-2']!, 0, 1);
    ({ matches } = await started.bracket());
    // Cached views are invalidated by live events; bump directly since no worker runs here.
    await app.get(CacheService).bumpTournament(started.tournamentId);

    const upcoming = await http()
      .get(`/api/v1/public/tournaments/${slug}/matches?phase=upcoming`)
      .expect(200);
    expect(upcoming.body.map((m: { key: string }) => m.key)).toEqual(['W2-1']);
    const results = await http()
      .get(`/api/v1/public/tournaments/${slug}/matches?phase=completed`)
      .expect(200);
    expect(results.body).toHaveLength(2);

    await playMatch(app, started, matches['W2-1']!, 1, 0);
    await app.get(CacheService).bumpTournament(started.tournamentId);
    const bracket = await http().get(`/api/v1/public/tournaments/${slug}/bracket`).expect(200);
    expect(bracket.body.status).toBe('COMPLETED');
    const championTeam = matches['W2-1']!.a!.teamId;
    expect(bracket.body.championTeamId).toBe(championTeam);
    const standings = await http().get(`/api/v1/public/tournaments/${slug}/standings`).expect(200);
    expect(standings.body[0]).toMatchObject({
      teamId: championTeam,
      placement: 1,
      wins: 2,
      losses: 0,
    });

    const profile = await http().get(`/api/v1/public/teams/${championTeam}`).expect(200);
    expect(profile.body.record).toEqual({ wins: 2, losses: 0, tournaments: 1, titles: 1 });
    expect(profile.body.history[0]).toMatchObject({
      result: 'WIN',
      tournamentName: 'Public Finals',
      roundName: 'Final',
    });

    const board = await http().get(`/api/v1/public/orgs/${'nordic-arena'}/leaderboard`).expect(200);
    expect(board.body[0]).toMatchObject({ rank: 1, teamId: championTeam, titles: 1 });
    expect(board.body).toHaveLength(4);
  });

  it('serves cached views until a live event bumps the tournament version', async () => {
    const started = await startTournament(app, org, 2, { name: 'Cache Cup' });
    const before = await http().get('/api/v1/public/tournaments/cache-cup/bracket').expect(200);
    expect(before.body.status).toBe('IN_PROGRESS');
    const { matches } = await started.bracket();
    await playMatch(app, started, matches['W1-1']!, 1, 0);
    const stale = await http().get('/api/v1/public/tournaments/cache-cup/bracket').expect(200);
    expect(stale.body.status).toBe('IN_PROGRESS');
    await app.get(CacheService).bumpTournament(started.tournamentId);
    const fresh = await http().get('/api/v1/public/tournaments/cache-cup/bracket').expect(200);
    expect(fresh.body.status).toBe('COMPLETED');
  });

  it('searches teams and players by fuzzy name', async () => {
    const t = await createTournament(app, org);
    await approvedTeams(app, org, t.id, 1, { name: 'Phoenix Rising' });
    const teams = await http().get('/api/v1/public/teams?q=phenix').expect(200);
    expect(teams.body[0]).toMatchObject({ name: 'Phoenix Rising' });
    const players = await http().get('/api/v1/public/players?q=Player').expect(200);
    expect(players.body.length).toBeGreaterThan(0);
    await http().get('/api/v1/public/teams?q=a').expect(400);
  });
});

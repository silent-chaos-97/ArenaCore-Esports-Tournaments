import { Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type {
  BracketDto,
  DiscoverTournamentsQuery,
  LeaderboardRow,
  MatchSummaryDto,
  Page,
  PublicTeamEntry,
  PublicTournamentDetail,
  PublicTournamentSummary,
  SearchQuery,
  StandingDto,
  TeamHistoryEntry,
  TeamProfileDto,
} from '@arenacore/shared';
import type { Subscription } from 'rxjs';
import { CacheService } from '../../infra/cache/cache.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import {
  Prisma,
  type MatchStatus,
  type Tournament,
  type TournamentStatus,
} from '../../generated/prisma/client.js';
import { BracketQueryService } from '../competition/bracket-query.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';

const VISIBLE: TournamentStatus[] = ['PUBLISHED', 'IN_PROGRESS', 'COMPLETED'];
const PHASE_STATUS: Record<'upcoming' | 'live' | 'completed', TournamentStatus[]> = {
  upcoming: ['PUBLISHED'],
  live: ['IN_PROGRESS'],
  completed: ['COMPLETED'],
};
const MATCH_PHASE: Record<'upcoming' | 'live' | 'completed', MatchStatus[]> = {
  upcoming: ['SCHEDULED', 'CHECK_IN_OPEN', 'CHECK_IN_EXPIRED', 'NO_SHOW_REVIEW', 'READY'],
  live: ['IN_PROGRESS', 'RESULT_PENDING', 'DISPUTED'],
  completed: ['COMPLETED', 'FORFEITED'],
};
const ENTERED = ['APPROVED', 'CHECKED_IN'] as const;
const VIEW_TTL = 30;
/** Typo tolerance for name search (pg_trgm word similarity, 0..1). */
const FUZZY_THRESHOLD = 0.4;

type TournamentRow = Tournament & {
  game: { name: string; slug: string };
  organization: { name: string; slug: string };
};
const summaryInclude = {
  game: { select: { name: true, slug: true } },
  organization: { select: { name: true, slug: true } },
} as const;

/** Anonymous read models for the public portal. Only published tournaments are ever exposed. */
@Injectable()
export class PublicService implements OnModuleInit, OnModuleDestroy {
  private subscription?: Subscription;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly brackets: BracketQueryService,
    private readonly realtime: RealtimeService,
  ) {}

  onModuleInit(): void {
    // Live events invalidate every cached view of the affected tournament.
    this.subscription = this.realtime.all$().subscribe((event) => {
      if (event.tournamentId) void this.cache.bumpTournament(event.tournamentId);
    });
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }

  async discover(query: DiscoverTournamentsQuery): Promise<Page<PublicTournamentSummary>> {
    const statuses = query.phase ? PHASE_STATUS[query.phase] : VISIBLE;
    const offset = query.cursor ?? 0;
    const where: Prisma.TournamentWhereInput = {
      status: { in: statuses },
      ...(query.game ? { game: { slug: query.game } } : {}),
      ...(query.region ? { region: { equals: query.region, mode: 'insensitive' } } : {}),
    };

    let rows: TournamentRow[];
    const tsQuery = toPrefixTsQuery(query.q);
    if (tsQuery) {
      const ranked = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT t.id FROM tournaments t JOIN games g ON g.id = t."gameId"
        WHERE t.search @@ to_tsquery('simple', ${tsQuery})
          AND t.status::text = ANY(${statuses})
          ${query.game ? Prisma.sql`AND g.slug = ${query.game}` : Prisma.empty}
          ${query.region ? Prisma.sql`AND lower(t.region) = lower(${query.region})` : Prisma.empty}
        ORDER BY ts_rank(t.search, to_tsquery('simple', ${tsQuery})) DESC, t."startsAt" ASC
        LIMIT ${query.limit + 1} OFFSET ${offset}`;
      const byId = new Map(
        (
          await this.prisma.tournament.findMany({
            where: { id: { in: ranked.map((r) => r.id) } },
            include: summaryInclude,
          })
        ).map((t) => [t.id, t]),
      );
      rows = ranked.map((r) => byId.get(r.id)!).filter(Boolean);
    } else {
      rows = await this.prisma.tournament.findMany({
        where,
        include: summaryInclude,
        orderBy: query.phase === 'upcoming' ? { startsAt: 'asc' } : { startsAt: 'desc' },
        skip: offset,
        take: query.limit + 1,
      });
    }
    const page = rows.slice(0, query.limit);
    const counts = await this.enteredCounts(page.map((t) => t.id));
    return {
      items: page.map((t) => toSummary(t, counts.get(t.id) ?? 0)),
      nextCursor: rows.length > query.limit ? String(offset + query.limit) : null,
    };
  }

  async tournament(slug: string): Promise<PublicTournamentDetail> {
    const t = await this.bySlug(slug);
    return this.cache.getOrSet(
      `pub:t:${t.id}:${await this.cache.tournamentVersion(t.id)}:detail`,
      15,
      async () => {
        const entered = (await this.enteredCounts([t.id])).get(t.id) ?? 0;
        const now = new Date();
        const champion =
          t.status === 'COMPLETED'
            ? await this.prisma.standing.findFirst({ where: { tournamentId: t.id, placement: 1 } })
            : null;
        return {
          ...toSummary(t, entered),
          description: t.description,
          rules: t.rules,
          rulesVersion: t.rulesVersion,
          bestOf: t.bestOf,
          finalsBestOf: t.finalsBestOf,
          maxSubstitutes: t.maxSubstitutes,
          minAge: t.minAge,
          checkInOpensAt: t.checkInOpensAt?.toISOString() ?? null,
          checkInClosesAt: t.checkInClosesAt?.toISOString() ?? null,
          registrationOpen:
            t.status === 'PUBLISHED' &&
            now >= t.registrationOpensAt &&
            now <= t.registrationClosesAt &&
            entered < t.maxTeams,
          championTeamId: champion?.teamId ?? null,
        };
      },
    );
  }

  async teams(slug: string): Promise<PublicTeamEntry[]> {
    const t = await this.bySlug(slug);
    const regs = await this.prisma.registration.findMany({
      where: { tournamentId: t.id, status: { in: [...ENTERED] } },
      include: { team: true },
      orderBy: [{ seed: 'asc' }, { createdAt: 'asc' }],
    });
    return regs.map((r) => ({
      registrationId: r.id,
      teamId: r.teamId,
      teamName: r.team.name,
      tag: r.team.tag,
      logoUrl: r.team.logoUrl,
      seed: r.seed,
      status: r.status,
    }));
  }

  async bracket(slug: string): Promise<BracketDto> {
    const t = await this.bySlug(slug);
    return this.cache.getOrSet(
      `pub:t:${t.id}:${await this.cache.tournamentVersion(t.id)}:bracket`,
      VIEW_TTL,
      () => this.brackets.bracket(t.id),
    );
  }

  async standings(slug: string): Promise<StandingDto[]> {
    const t = await this.bySlug(slug);
    return this.cache.getOrSet(
      `pub:t:${t.id}:${await this.cache.tournamentVersion(t.id)}:standings`,
      VIEW_TTL,
      () => this.brackets.standings(t.id),
    );
  }

  async matches(
    slug: string,
    phase?: 'upcoming' | 'live' | 'completed',
  ): Promise<MatchSummaryDto[]> {
    const t = await this.bySlug(slug);
    const statuses = phase
      ? MATCH_PHASE[phase]
      : [...MATCH_PHASE.upcoming, ...MATCH_PHASE.live, ...MATCH_PHASE.completed];
    return this.cache.getOrSet(
      `pub:t:${t.id}:${await this.cache.tournamentVersion(t.id)}:matches:${phase ?? 'all'}`,
      VIEW_TTL,
      () => this.brackets.matches(t.id, { isBye: false, status: { in: statuses } }),
    );
  }

  async searchTeams(query: SearchQuery) {
    return this.prisma.$queryRaw<
      { id: string; name: string; slug: string; tag: string | null; logoUrl: string | null }[]
    >`
      SELECT id, name, slug, tag, "logoUrl" FROM teams
      WHERE status = 'ACTIVE' AND (word_similarity(${query.q}, name) >= ${FUZZY_THRESHOLD} OR name ILIKE ${`%${escapeLike(query.q)}%`})
      ORDER BY word_similarity(${query.q}, name) DESC, name ASC
      LIMIT ${query.limit}`;
  }

  async searchPlayers(query: SearchQuery) {
    return this.prisma.$queryRaw<{ id: string; displayName: string; country: string | null }[]>`
      SELECT id, "displayName", country FROM players
      WHERE status = 'ACTIVE' AND (word_similarity(${query.q}, "displayName") >= ${FUZZY_THRESHOLD} OR "displayName" ILIKE ${`%${escapeLike(query.q)}%`})
      ORDER BY word_similarity(${query.q}, "displayName") DESC, "displayName" ASC
      LIMIT ${query.limit}`;
  }

  /** Team win/loss record, titles and public match history. */
  async team(teamId: string): Promise<TeamProfileDto> {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: {
        members: {
          where: { leftAt: null },
          include: { player: true },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });
    if (!team) throw new NotFoundException('Team not found');
    const played = await this.prisma.matchParticipant.findMany({
      where: {
        teamId,
        match: {
          isBye: false,
          status: { in: ['COMPLETED', 'FORFEITED'] },
          tournament: { status: { in: VISIBLE } },
        },
      },
      include: {
        match: {
          include: {
            round: { select: { name: true } },
            tournament: { select: { name: true } },
            participants: { include: { team: { select: { name: true } } } },
          },
        },
      },
      orderBy: { match: { completedAt: 'desc' } },
      take: 50,
    });
    const history: TeamHistoryEntry[] = played.map(({ slot, match }) => {
      const opponent = match.participants.find((p) => p.slot !== slot);
      const own = slot === 'A' ? match.scoreA : match.scoreB;
      const theirs = slot === 'A' ? match.scoreB : match.scoreA;
      return {
        matchId: match.id,
        tournamentId: match.tournamentId,
        tournamentName: match.tournament.name,
        roundName: match.round.name,
        opponentTeamId: opponent?.teamId ?? null,
        opponentName: opponent?.team.name ?? null,
        scoreFor: own,
        scoreAgainst: theirs,
        result: match.winnerSlot === slot ? 'WIN' : 'LOSS',
        forfeit: match.status === 'FORFEITED',
        completedAt: match.completedAt?.toISOString() ?? null,
      };
    });
    const standings = await this.prisma.standing.findMany({
      where: { teamId, tournament: { status: { in: ['IN_PROGRESS', 'COMPLETED'] } } },
      include: { tournament: { select: { status: true } } },
    });
    return {
      id: team.id,
      name: team.name,
      slug: team.slug,
      tag: team.tag,
      logoUrl: team.logoUrl,
      members: team.members.map((m) => ({
        playerId: m.playerId,
        displayName: m.player.displayName,
        role: m.role,
      })),
      record: {
        wins: history.filter((h) => h.result === 'WIN').length,
        losses: history.filter((h) => h.result === 'LOSS').length,
        tournaments: standings.length,
        titles: standings.filter((s) => s.placement === 1 && s.tournament.status === 'COMPLETED')
          .length,
      },
      history,
    };
  }

  /** Organization leaderboard across all of its started tournaments. */
  async leaderboard(orgSlug: string): Promise<LeaderboardRow[]> {
    const org = await this.prisma.organization.findUnique({ where: { slug: orgSlug } });
    if (!org) throw new NotFoundException('Organization not found');
    return this.cache.getOrSet(`pub:org:${org.id}:leaderboard`, 60, async () => {
      const rows = await this.prisma.$queryRaw<
        {
          teamId: string;
          teamName: string;
          tournaments: bigint;
          titles: bigint;
          wins: bigint;
          losses: bigint;
          best: number | null;
        }[]
      >`
        SELECT s."teamId", tm.name AS "teamName",
               COUNT(*) AS tournaments,
               COUNT(*) FILTER (WHERE s.placement = 1 AND t.status = 'COMPLETED') AS titles,
               COALESCE(SUM(s.wins), 0) AS wins,
               COALESCE(SUM(s.losses), 0) AS losses,
               MIN(s.placement) AS best
        FROM standings s
        JOIN tournaments t ON t.id = s."tournamentId"
        JOIN teams tm ON tm.id = s."teamId"
        WHERE t."organizationId" = ${org.id}::uuid AND t.status IN ('IN_PROGRESS', 'COMPLETED')
        GROUP BY s."teamId", tm.name
        ORDER BY titles DESC, wins DESC, losses ASC, tm.name ASC
        LIMIT 100`;
      return rows.map((r, i) => ({
        rank: i + 1,
        teamId: r.teamId,
        teamName: r.teamName,
        tournaments: Number(r.tournaments),
        titles: Number(r.titles),
        wins: Number(r.wins),
        losses: Number(r.losses),
        bestPlacement: r.best,
      }));
    });
  }

  private async bySlug(slug: string): Promise<TournamentRow> {
    const t = await this.prisma.tournament.findUnique({ where: { slug }, include: summaryInclude });
    if (!t || !VISIBLE.includes(t.status)) throw new NotFoundException('Tournament not found');
    return t;
  }

  private async enteredCounts(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const grouped = await this.prisma.registration.groupBy({
      by: ['tournamentId'],
      where: { tournamentId: { in: ids }, status: { in: [...ENTERED] } },
      _count: { _all: true },
    });
    return new Map(grouped.map((g) => [g.tournamentId, g._count._all]));
  }
}

/** "spring cu" → "spring:* & cu:*" (prefix matching while typing); null when nothing searchable. */
export function toPrefixTsQuery(q: string | undefined): string | null {
  const terms = (q ?? '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 8);
  return terms.length > 0 ? terms.map((t) => `${t}:*`).join(' & ') : null;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function toSummary(t: TournamentRow, registeredTeams: number): PublicTournamentSummary {
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    gameName: t.game.name,
    gameSlug: t.game.slug,
    region: t.region,
    format: t.format,
    teamSize: t.teamSize,
    maxTeams: t.maxTeams,
    registeredTeams,
    status: t.status,
    startsAt: t.startsAt.toISOString(),
    registrationOpensAt: t.registrationOpensAt.toISOString(),
    registrationClosesAt: t.registrationClosesAt.toISOString(),
    organizationName: t.organization.name,
    organizationSlug: t.organization.slug,
    prizeInfo: t.prizeInfo,
  };
}

import { Injectable } from '@nestjs/common';
import type { BracketDto, MatchSummaryDto, StandingDto } from '@arenacore/shared';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';

export const matchSummaryInclude = {
  round: { select: { name: true } },
  participants: {
    include: { team: { select: { name: true } }, registration: { select: { seed: true } } },
  },
} satisfies Prisma.MatchInclude;
export type MatchSummaryRow = Prisma.MatchGetPayload<{ include: typeof matchSummaryInclude }>;

export function toMatchSummary(m: MatchSummaryRow): MatchSummaryDto {
  const side = (slot: 'A' | 'B') => {
    const p = m.participants.find((x) => x.slot === slot);
    return p
      ? {
          registrationId: p.registrationId,
          teamId: p.teamId,
          teamName: p.team.name,
          seed: p.registration.seed,
          checkedIn: p.checkedInAt !== null,
        }
      : null;
  };
  const iso = (d: Date | null) => d?.toISOString() ?? null;
  return {
    id: m.id,
    key: m.key,
    tournamentId: m.tournamentId,
    bracket: m.bracket,
    round: m.roundNumber,
    roundName: m.round.name,
    position: m.position,
    status: m.status,
    bestOf: m.bestOf,
    scheduledAt: iso(m.scheduledAt),
    checkInOpensAt: iso(m.checkInOpensAt),
    checkInDeadline: iso(m.checkInDeadline),
    scoreA: m.scoreA,
    scoreB: m.scoreB,
    winnerSlot: m.winnerSlot,
    isBye: m.isBye,
    version: m.version,
    a: side('A'),
    b: side('B'),
    winnerToMatchId: m.winnerToMatchId,
    loserToMatchId: m.loserToMatchId,
  };
}

/** Read models for brackets and standings, shared by organizer and public endpoints. */
@Injectable()
export class BracketQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async bracket(tournamentId: string): Promise<BracketDto> {
    const tournament = await this.prisma.tournament.findUniqueOrThrow({
      where: { id: tournamentId },
    });
    const stages = await this.prisma.stage.findMany({
      where: { tournamentId },
      orderBy: { order: 'asc' },
      include: {
        rounds: {
          orderBy: [{ bracket: 'asc' }, { number: 'asc' }],
          include: { matches: { include: matchSummaryInclude, orderBy: { position: 'asc' } } },
        },
      },
    });
    const championStanding = await this.prisma.standing.findFirst({
      where: { tournamentId, placement: 1 },
    });
    return {
      tournamentId,
      status: tournament.status,
      championTeamId: tournament.status === 'COMPLETED' ? (championStanding?.teamId ?? null) : null,
      stages: stages.map((s) => ({
        id: s.id,
        name: s.name,
        format: s.format,
        status: s.status,
        rounds: s.rounds.map((r) => ({
          id: r.id,
          bracket: r.bracket,
          number: r.number,
          name: r.name,
          bestOf: r.bestOf,
          matches: r.matches.map(toMatchSummary),
        })),
      })),
    };
  }

  async standings(tournamentId: string): Promise<StandingDto[]> {
    const rows = await this.prisma.standing.findMany({
      where: { tournamentId },
      include: { team: { select: { name: true } }, registration: { select: { seed: true } } },
    });
    return rows
      .map((r) => ({
        registrationId: r.registrationId,
        teamId: r.teamId,
        teamName: r.team.name,
        seed: r.registration.seed,
        wins: r.wins,
        losses: r.losses,
        placement: r.placement,
        eliminated: r.eliminatedAt !== null,
      }))
      .sort(
        (a, b) =>
          (a.placement ?? Number.MAX_SAFE_INTEGER) - (b.placement ?? Number.MAX_SAFE_INTEGER) ||
          b.wins - a.wins ||
          (a.seed ?? 0) - (b.seed ?? 0),
      );
  }

  async matches(
    tournamentId: string,
    where: Prisma.MatchWhereInput = {},
  ): Promise<MatchSummaryDto[]> {
    const rows = await this.prisma.match.findMany({
      where: { tournamentId, ...where },
      include: matchSummaryInclude,
      orderBy: [
        { scheduledAt: 'asc' },
        { bracket: 'asc' },
        { roundNumber: 'asc' },
        { position: 'asc' },
      ],
    });
    return rows.map(toMatchSummary);
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import {
  assertTransition,
  matchMachine,
  type MatchEvidenceDto,
  type MatchResultDto,
  type MatchSummaryDto,
  type SetLobbyInput,
} from '@arenacore/shared';
import type { AuthUser } from '../../common/auth/auth.types.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { DomainError } from '../../common/errors/domain-error.js';
import { OutboxService } from '../../common/outbox/outbox.service.js';
import { AccessService } from '../../common/tenant/access.service.js';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service.js';
import type { Match } from '../../generated/prisma/client.js';
import { matchSummaryInclude, toMatchSummary } from '../competition/bracket-query.service.js';
import { assertNotFrozen, lockMatch, sideForUser } from './match-access.js';
import { GameProviderRegistry } from './providers/game-provider.js';

export interface MatchDetailDto extends MatchSummaryDto {
  externalMatchId: string | null;
  serverRegion: string | null;
  resultSource: string | null;
  results: MatchResultDto[];
  evidence: MatchEvidenceDto[];
  openDisputeId: string | null;
}

@Injectable()
export class MatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly providers: GameProviderRegistry,
  ) {}

  async publicSummary(matchId: string): Promise<MatchSummaryDto> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: { ...matchSummaryInclude, tournament: { select: { status: true } } },
    });
    if (!match || match.tournament.status === 'DRAFT')
      throw new NotFoundException('Match not found');
    return toMatchSummary(match);
  }

  /** Full detail for staff and for the two participating teams. */
  async detail(user: AuthUser, matchId: string): Promise<MatchDetailDto> {
    const match = await this.prisma.match.findUnique({ where: { id: matchId } });
    if (!match) throw new NotFoundException('Match not found');
    const isParticipant = await this.prisma.matchParticipant.count({
      where: {
        matchId,
        team: { members: { some: { leftAt: null, player: { userId: user.id } } } },
      },
    });
    if (!isParticipant) {
      await this.access.assertTournamentAccess(
        user,
        match.tournamentId,
        ['OWNER', 'ADMIN', 'REFEREE', 'VIEWER'],
        ['ADMIN', 'REFEREE'],
      );
    }
    return this.buildDetail(matchId);
  }

  /** Upcoming and live matches for the player's teams ("my next match"). */
  async mine(userId: string): Promise<MatchSummaryDto[]> {
    const rows = await this.prisma.match.findMany({
      where: {
        isBye: false,
        status: { notIn: ['PENDING', 'COMPLETED', 'FORFEITED', 'CANCELLED'] },
        participants: {
          some: { team: { members: { some: { leftAt: null, player: { userId } } } } },
        },
      },
      include: matchSummaryInclude,
      orderBy: [{ scheduledAt: 'asc' }],
    });
    return rows.map(toMatchSummary);
  }

  /** Match check-in by a captain/manager. Both sides checked in → READY. */
  async checkIn(userId: string, matchId: string, now = new Date()): Promise<MatchSummaryDto> {
    await this.prisma.$transaction(async (tx) => {
      let match = await lockMatch(tx, matchId);
      const side = await sideForUser(tx, matchId, userId);
      if (match.status === 'READY' || match.status === 'IN_PROGRESS') return;
      if (match.status !== 'SCHEDULED' && match.status !== 'CHECK_IN_OPEN') {
        throw new DomainError(
          'CHECK_IN_UNAVAILABLE',
          `Check-in is not available while the match is ${match.status}`,
          409,
        );
      }
      await assertNotFrozen(tx, match);
      if (match.checkInOpensAt && now < match.checkInOpensAt) {
        throw new DomainError('CHECK_IN_NOT_OPEN', 'Match check-in has not opened yet', 409, {
          opensAt: match.checkInOpensAt.toISOString(),
        });
      }
      if (match.checkInDeadline && now > match.checkInDeadline) {
        throw new DomainError('CHECK_IN_CLOSED', 'Match check-in has closed', 409);
      }
      if (match.status === 'SCHEDULED') match = await this.move(tx, match, 'CHECK_IN_OPEN');

      const participant = await tx.matchParticipant.findUniqueOrThrow({
        where: { matchId_slot: { matchId, slot: side.slot } },
      });
      if (!participant.checkedInAt) {
        await tx.matchParticipant.update({
          where: { id: participant.id },
          data: { checkedInAt: now },
        });
        const opponent = await tx.matchParticipant.findUnique({
          where: { matchId_slot: { matchId, slot: side.slot === 'A' ? 'B' : 'A' } },
        });
        await this.outbox.emit(tx, {
          type: 'OpponentCheckedIn',
          aggregateType: 'Match',
          aggregateId: matchId,
          organizationId: match.organizationId,
          payload: {
            matchId,
            tournamentId: match.tournamentId,
            slot: side.slot,
            notifyRegistrationId: opponent?.registrationId ?? null,
          },
        });
      }
      const checkedIn = await tx.matchParticipant.count({
        where: { matchId, checkedInAt: { not: null } },
      });
      if (checkedIn === 2) await this.move(tx, match, 'READY');
    });
    return this.summary(matchId);
  }

  async setLobby(
    user: AuthUser,
    orgId: string,
    matchId: string,
    input: SetLobbyInput,
  ): Promise<MatchDetailDto> {
    const match = await this.findInOrg(orgId, matchId);
    await this.access.assertTournamentAccess(
      user,
      match.tournamentId,
      ['OWNER', 'ADMIN'],
      ['ADMIN', 'REFEREE'],
    );
    await this.prisma.$transaction(async (tx) => {
      const current = await lockMatch(tx, matchId);
      await tx.match.update({
        where: { id: matchId },
        data: {
          externalMatchId: input.externalMatchId,
          serverRegion: input.serverRegion,
          version: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        organizationId: orgId,
        actorId: user.id,
        action: 'match.lobby_updated',
        entity: 'Match',
        entityId: matchId,
        oldValue: { externalMatchId: current.externalMatchId, serverRegion: current.serverRegion },
        newValue: input,
      });
    });
    return this.buildDetail(matchId);
  }

  /** Asks the game's provider adapter for a lobby and stores the identifier on the match. */
  async createLobby(
    user: AuthUser,
    orgId: string,
    matchId: string,
  ): Promise<MatchDetailDto & { joinCode?: string }> {
    const match = await this.findInOrg(orgId, matchId);
    await this.access.assertTournamentAccess(
      user,
      match.tournamentId,
      ['OWNER', 'ADMIN'],
      ['ADMIN', 'REFEREE'],
    );
    const tournament = await this.prisma.tournament.findUniqueOrThrow({
      where: { id: match.tournamentId },
      include: { game: true },
    });
    const lobby = await this.providers
      .forGame(tournament.game.providerKey)
      .createLobby({ matchId, region: tournament.region });
    const detail = await this.setLobby(user, orgId, matchId, {
      externalMatchId: lobby.externalMatchId,
      serverRegion: lobby.serverRegion ?? null,
    });
    return { ...detail, joinCode: lobby.joinCode };
  }

  /**
   * Scheduler tick (run by the worker): opens due check-in windows and moves matches whose
   * window closed without both teams to CHECK_IN_EXPIRED → NO_SHOW_REVIEW.
   */
  async runCheckInTick(now = new Date()): Promise<{ opened: number; expired: number }> {
    let opened = 0;
    let expired = 0;
    const due = await this.prisma.match.findMany({
      where: { status: 'SCHEDULED', checkInOpensAt: { lte: now }, isBye: false },
      select: { id: true },
    });
    for (const { id } of due) {
      await this.prisma.$transaction(async (tx) => {
        const match = await lockMatch(tx, id);
        if (match.status !== 'SCHEDULED') return;
        await this.move(tx, match, 'CHECK_IN_OPEN');
        await this.outbox.emit(tx, {
          type: 'CheckInOpened',
          aggregateType: 'Match',
          aggregateId: id,
          organizationId: match.organizationId,
          payload: {
            matchId: id,
            tournamentId: match.tournamentId,
            deadline: match.checkInDeadline?.toISOString() ?? null,
          },
        });
        opened += 1;
      });
    }
    const overdue = await this.prisma.match.findMany({
      where: { status: 'CHECK_IN_OPEN', checkInDeadline: { lte: now } },
      select: { id: true },
    });
    for (const { id } of overdue) {
      await this.prisma.$transaction(async (tx) => {
        let match = await lockMatch(tx, id);
        if (match.status !== 'CHECK_IN_OPEN') return;
        const participants = await tx.matchParticipant.findMany({ where: { matchId: id } });
        const missing = participants.filter((p) => !p.checkedInAt).map((p) => p.slot);
        match = await this.move(tx, match, 'CHECK_IN_EXPIRED');
        await this.move(tx, match, 'NO_SHOW_REVIEW');
        await this.outbox.emit(tx, {
          type: 'CheckInExpired',
          aggregateType: 'Match',
          aggregateId: id,
          organizationId: match.organizationId,
          payload: { matchId: id, tournamentId: match.tournamentId, missingSlots: missing },
        });
        expired += 1;
      });
    }
    return { opened, expired };
  }

  private async move(tx: Tx, match: Match, to: Match['status']): Promise<Match> {
    assertTransition(matchMachine, match.status, to);
    const updated = await tx.match.updateMany({
      where: { id: match.id, version: match.version },
      data: { status: to, version: { increment: 1 } },
    });
    if (updated.count === 0)
      throw new DomainError('STALE_VERSION', 'Match changed concurrently; retry', 409);
    return tx.match.findUniqueOrThrow({ where: { id: match.id } });
  }

  private async findInOrg(orgId: string, matchId: string): Promise<Match> {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, organizationId: orgId },
    });
    if (!match) throw new NotFoundException('Match not found');
    return match;
  }

  async summary(matchId: string): Promise<MatchSummaryDto> {
    return toMatchSummary(
      await this.prisma.match.findUniqueOrThrow({
        where: { id: matchId },
        include: matchSummaryInclude,
      }),
    );
  }

  async buildDetail(matchId: string): Promise<MatchDetailDto> {
    const match = await this.prisma.match.findUniqueOrThrow({
      where: { id: matchId },
      include: {
        ...matchSummaryInclude,
        results: { orderBy: { createdAt: 'asc' } },
        evidence: { orderBy: { createdAt: 'asc' } },
        disputes: {
          where: { status: { in: ['OPEN', 'ASSIGNED', 'INVESTIGATING'] } },
          select: { id: true },
        },
      },
    });
    return {
      ...toMatchSummary(match),
      externalMatchId: match.externalMatchId,
      serverRegion: match.serverRegion,
      resultSource: match.resultSource,
      results: match.results.map((r) => ({
        id: r.id,
        source: r.source,
        reportedBySlot: r.reportedBySlot,
        scoreA: r.scoreA,
        scoreB: r.scoreB,
        winnerSlot: r.winnerSlot,
        status: r.status,
        note: r.note,
        createdAt: r.createdAt.toISOString(),
      })),
      evidence: match.evidence.map((e) => ({
        id: e.id,
        kind: e.kind,
        url: e.url,
        text: e.text,
        storageKey: e.storageKey,
        contentType: e.contentType,
        uploadedById: e.uploadedById,
        createdAt: e.createdAt.toISOString(),
      })),
      openDisputeId: match.disputes[0]?.id ?? null,
    };
  }
}

import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { shuffleSeeds } from '@arenacore/bracket';
import {
  assertTransition,
  registrationMachine,
  tournamentMachine,
  type BracketDto,
  type MatchSummaryDto,
  type OrgRole,
} from '@arenacore/shared';
import { randomInt } from 'node:crypto';
import type { AuthUser } from '../../common/auth/auth.types.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { DomainError } from '../../common/errors/domain-error.js';
import { OutboxService } from '../../common/outbox/outbox.service.js';
import { AccessService } from '../../common/tenant/access.service.js';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service.js';
import type { Registration, Tournament } from '../../generated/prisma/client.js';
import { RegistrationsService } from '../registrations/registrations.service.js';
import { TeamsService } from '../teams/teams.service.js';
import {
  BracketQueryService,
  matchSummaryInclude,
  toMatchSummary,
} from './bracket-query.service.js';
import { BracketStore } from './bracket-store.js';

const ORGANIZER: OrgRole[] = ['OWNER', 'ADMIN'];

@Injectable()
export class CompetitionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly teams: TeamsService,
    private readonly registrations: RegistrationsService,
    private readonly store: BracketStore,
    private readonly query: BracketQueryService,
  ) {}

  /** Tournament check-in by the captain/manager during the configured window. Idempotent. */
  async checkIn(userId: string, tournamentId: string, teamId: string) {
    await this.teams.requireManager(userId, teamId);
    return this.prisma.$transaction(async (tx) => {
      const tournament = await this.lockTournament(tx, tournamentId);
      const reg = await tx.registration.findUnique({
        where: { tournamentId_teamId: { tournamentId, teamId } },
      });
      if (!reg || tournament.status !== 'PUBLISHED')
        throw new NotFoundException('Registration not found');
      if (reg.status === 'CHECKED_IN') return this.registrationDto(tx, reg.id);
      if (!tournament.checkInOpensAt || !tournament.checkInClosesAt) {
        throw new DomainError(
          'CHECK_IN_NOT_REQUIRED',
          'This tournament does not use check-in',
          409,
        );
      }
      const now = new Date();
      if (now < tournament.checkInOpensAt || now > tournament.checkInClosesAt) {
        throw new DomainError('CHECK_IN_CLOSED', 'Check-in is not open', 409, {
          opensAt: tournament.checkInOpensAt.toISOString(),
          closesAt: tournament.checkInClosesAt.toISOString(),
        });
      }
      await this.markCheckedIn(tx, reg);
      return this.registrationDto(tx, reg.id);
    });
  }

  /** Organizer override: check a team in regardless of the window. */
  async adminCheckIn(user: AuthUser, orgId: string, tournamentId: string, registrationId: string) {
    await this.authorize(user, orgId, tournamentId);
    return this.prisma.$transaction(async (tx) => {
      const tournament = await this.lockTournament(tx, tournamentId);
      if (tournament.status !== 'PUBLISHED')
        throw new DomainError('TOURNAMENT_STARTED', 'Tournament already started', 409);
      const reg = await tx.registration.findFirst({ where: { id: registrationId, tournamentId } });
      if (!reg) throw new NotFoundException('Registration not found');
      if (reg.status !== 'CHECKED_IN') {
        await this.markCheckedIn(tx, reg);
        await this.audit.record(tx, {
          organizationId: orgId,
          actorId: user.id,
          action: 'registration.checked_in_by_admin',
          entity: 'Registration',
          entityId: reg.id,
          oldValue: { status: reg.status },
          newValue: { status: 'CHECKED_IN' },
        });
      }
      return this.registrationDto(tx, reg.id);
    });
  }

  async setSeeding(user: AuthUser, orgId: string, tournamentId: string, order: string[]) {
    await this.authorize(user, orgId, tournamentId);
    await this.prisma.$transaction(async (tx) => {
      const tournament = await this.lockTournament(tx, tournamentId);
      this.assertNotStarted(tournament);
      const eligible = await this.eligible(tx, tournament);
      const eligibleIds = new Set(eligible.map((r) => r.id));
      const unknown = order.filter((id) => !eligibleIds.has(id));
      if (unknown.length > 0) {
        throw new DomainError(
          'INVALID_SEEDING',
          'Seeding contains registrations that are not eligible',
          422,
          { unknown },
        );
      }
      await this.writeSeeds(tx, tournamentId, order);
      await this.audit.record(tx, {
        organizationId: orgId,
        actorId: user.id,
        action: 'tournament.seeded',
        entity: 'Tournament',
        entityId: tournamentId,
        newValue: { order },
      });
    });
    return this.registrations.list(user, orgId, tournamentId);
  }

  async randomizeSeeding(user: AuthUser, orgId: string, tournamentId: string, seed?: number) {
    await this.authorize(user, orgId, tournamentId);
    const usedSeed = seed ?? randomInt(1, 2 ** 31);
    await this.prisma.$transaction(async (tx) => {
      const tournament = await this.lockTournament(tx, tournamentId);
      this.assertNotStarted(tournament);
      const eligible = await this.eligible(tx, tournament);
      const order = shuffleSeeds(eligible.map((r) => r.id).sort(), usedSeed);
      await this.writeSeeds(tx, tournamentId, order);
      await this.audit.record(tx, {
        organizationId: orgId,
        actorId: user.id,
        action: 'tournament.seeded_randomly',
        entity: 'Tournament',
        entityId: tournamentId,
        newValue: { seed: usedSeed, order },
      });
    });
    return {
      seed: usedSeed,
      registrations: await this.registrations.list(user, orgId, tournamentId),
    };
  }

  /**
   * Locks the field, generates the bracket and moves the tournament to IN_PROGRESS. Teams that
   * failed to check in (when check-in is used) do not take part.
   */
  async start(user: AuthUser, orgId: string, tournamentId: string): Promise<BracketDto> {
    await this.authorize(user, orgId, tournamentId);
    await this.prisma.$transaction(async (tx) => {
      const tournament = await this.lockTournament(tx, tournamentId);
      assertTransition(tournamentMachine, tournament.status, 'IN_PROGRESS');
      const eligible = await this.eligible(tx, tournament);
      if (eligible.length < 2) {
        throw new DomainError(
          'NOT_ENOUGH_TEAMS',
          'At least two eligible teams are required to start',
          422,
        );
      }
      const seeded = eligible
        .filter((r) => r.seed !== null)
        .sort((a, b) => a.seed! - b.seed!)
        .map((r) => r.id);
      const unseeded = shuffleSeeds(
        eligible
          .filter((r) => r.seed === null)
          .map((r) => r.id)
          .sort(),
        randomInt(1, 2 ** 31),
      );
      const order = [...seeded, ...unseeded];
      await this.writeSeeds(tx, tournamentId, order);

      const updated = await tx.tournament.updateMany({
        where: { id: tournament.id, version: tournament.version, status: 'PUBLISHED' },
        data: { status: 'IN_PROGRESS', version: { increment: 1 } },
      });
      if (updated.count === 0)
        throw new DomainError('STALE_VERSION', 'Tournament changed concurrently; retry', 409);
      await this.store.create(tx, { ...tournament, status: 'IN_PROGRESS' }, order);
      await this.audit.record(tx, {
        organizationId: orgId,
        actorId: user.id,
        action: 'tournament.started',
        entity: 'Tournament',
        entityId: tournament.id,
        oldValue: { status: tournament.status },
        newValue: { status: 'IN_PROGRESS', participants: order },
      });
      await this.outbox.emit(tx, {
        type: 'TournamentStarted',
        aggregateType: 'Tournament',
        aggregateId: tournament.id,
        organizationId: orgId,
        payload: { tournamentId: tournament.id, name: tournament.name, participants: order.length },
      });
    });
    return this.query.bracket(tournamentId);
  }

  async bracket(user: AuthUser, orgId: string, tournamentId: string): Promise<BracketDto> {
    await this.authorize(
      user,
      orgId,
      tournamentId,
      ['OWNER', 'ADMIN', 'REFEREE', 'VIEWER'],
      ['ADMIN', 'REFEREE'],
    );
    return this.query.bracket(tournamentId);
  }

  async matches(
    user: AuthUser,
    orgId: string,
    tournamentId: string,
    status?: string,
  ): Promise<MatchSummaryDto[]> {
    await this.authorize(
      user,
      orgId,
      tournamentId,
      ['OWNER', 'ADMIN', 'REFEREE', 'VIEWER'],
      ['ADMIN', 'REFEREE'],
    );
    return this.query.matches(
      tournamentId,
      status ? { status: status as never } : { isBye: false },
    );
  }

  /** Reschedules one match; participants are notified through MatchRescheduled. */
  async scheduleMatch(
    user: AuthUser,
    orgId: string,
    matchId: string,
    scheduledAt: Date,
    reason?: string,
  ) {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, organizationId: orgId },
    });
    if (!match) throw new NotFoundException('Match not found');
    await this.authorize(user, orgId, match.tournamentId, ORGANIZER, ['ADMIN']);
    return this.prisma.$transaction(async (tx) => {
      const tournament = await tx.tournament.findUniqueOrThrow({
        where: { id: match.tournamentId },
      });
      const current = await tx.match.findUniqueOrThrow({ where: { id: matchId } });
      if (
        !['PENDING', 'SCHEDULED', 'CHECK_IN_OPEN', 'CHECK_IN_EXPIRED', 'NO_SHOW_REVIEW'].includes(
          current.status,
        )
      ) {
        throw new DomainError(
          'MATCH_STARTED',
          'Only matches that have not started can be rescheduled',
          409,
        );
      }
      const updated = await tx.match.update({
        where: { id: matchId, version: current.version },
        data: {
          scheduledAt,
          checkInOpensAt: new Date(scheduledAt.getTime() - tournament.matchCheckInMinutes * 60_000),
          checkInDeadline: scheduledAt,
          // Moving a match re-opens the check-in lifecycle.
          ...(['CHECK_IN_OPEN', 'CHECK_IN_EXPIRED', 'NO_SHOW_REVIEW'].includes(current.status)
            ? { status: 'SCHEDULED' as const }
            : {}),
          version: { increment: 1 },
        },
        include: matchSummaryInclude,
      });
      await this.audit.record(tx, {
        organizationId: orgId,
        actorId: user.id,
        action: 'match.rescheduled',
        entity: 'Match',
        entityId: matchId,
        oldValue: { scheduledAt: current.scheduledAt },
        newValue: { scheduledAt },
        reason,
      });
      await this.outbox.emit(tx, {
        type: 'MatchRescheduled',
        aggregateType: 'Match',
        aggregateId: matchId,
        organizationId: orgId,
        payload: {
          matchId,
          tournamentId: match.tournamentId,
          scheduledAt: scheduledAt.toISOString(),
          previous: current.scheduledAt,
        },
      });
      return toMatchSummary(updated);
    });
  }

  private async markCheckedIn(tx: Tx, reg: Registration): Promise<void> {
    assertTransition(registrationMachine, reg.status, 'CHECKED_IN');
    await tx.registration.update({
      where: { id: reg.id, version: reg.version },
      data: { status: 'CHECKED_IN', checkedInAt: new Date(), version: { increment: 1 } },
    });
  }

  /** Teams that will be placed in the bracket. */
  private async eligible(tx: Tx, tournament: Tournament): Promise<Registration[]> {
    const usesCheckIn = tournament.checkInOpensAt !== null;
    return tx.registration.findMany({
      where: {
        tournamentId: tournament.id,
        status: { in: usesCheckIn ? ['CHECKED_IN'] : ['APPROVED', 'CHECKED_IN'] },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async writeSeeds(tx: Tx, tournamentId: string, order: string[]): Promise<void> {
    await tx.registration.updateMany({ where: { tournamentId }, data: { seed: null } });
    for (const [index, id] of order.entries()) {
      await tx.registration.update({ where: { id }, data: { seed: index + 1 } });
    }
  }

  private assertNotStarted(t: Tournament): void {
    if (t.status !== 'PUBLISHED')
      throw new DomainError(
        'TOURNAMENT_STARTED',
        'Seeding is locked once the tournament starts',
        409,
      );
  }

  private async lockTournament(tx: Tx, tournamentId: string): Promise<Tournament> {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM tournaments WHERE id = ${tournamentId}::uuid FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundException('Tournament not found');
    return tx.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
  }

  private async authorize(
    user: AuthUser,
    orgId: string,
    tournamentId: string,
    orgRoles: OrgRole[] = ORGANIZER,
    staffRoles: ('ADMIN' | 'REFEREE')[] = ['ADMIN'],
  ): Promise<void> {
    const access = await this.access.assertTournamentAccess(
      user,
      tournamentId,
      orgRoles,
      staffRoles,
    );
    if (access.orgId !== orgId) throw new ForbiddenException();
  }

  private async registrationDto(tx: Tx, id: string) {
    const reg = await tx.registration.findUniqueOrThrow({ where: { id } });
    return { id: reg.id, status: reg.status, checkedInAt: reg.checkedInAt?.toISOString() ?? null };
  }
}

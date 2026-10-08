import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  assertTransition,
  registrationMachine,
  type RegistrationDto,
  type RegistrationStatus,
  type RosterEntry,
  type RosterValidationError,
  type SubmitRegistrationInput,
  type UpdateRosterInput,
} from '@arenacore/shared';
import type { AuthUser } from '../../common/auth/auth.types.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { DomainError } from '../../common/errors/domain-error.js';
import { OutboxService } from '../../common/outbox/outbox.service.js';
import { AccessService } from '../../common/tenant/access.service.js';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service.js';
import type { Prisma, Tournament } from '../../generated/prisma/client.js';
import { TeamsService } from '../teams/teams.service.js';
import { validateRoster, type RosterCandidate } from './roster-validator.js';

const HOLDS_SLOT: RegistrationStatus[] = ['APPROVED', 'CHECKED_IN'];
const ACTIVE: RegistrationStatus[] = [
  'SUBMITTED',
  'VALIDATION_FAILED',
  'UNDER_REVIEW',
  'APPROVED',
  'CHECKED_IN',
];
const EDITABLE_ROSTER: RegistrationStatus[] = ['SUBMITTED', 'VALIDATION_FAILED', 'UNDER_REVIEW'];

const registrationInclude = {
  tournament: { select: { name: true } },
  team: { select: { name: true } },
  members: { include: { player: true, gameAccount: true } },
} satisfies Prisma.RegistrationInclude;
type RegistrationRow = Prisma.RegistrationGetPayload<{ include: typeof registrationInclude }>;

@Injectable()
export class RegistrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly teams: TeamsService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  // ───────────────────────────── Captain side ─────────────────────────────

  async submit(
    userId: string,
    tournamentId: string,
    input: SubmitRegistrationInput,
  ): Promise<RegistrationDto> {
    await this.teams.requireManager(userId, input.teamId);
    const id = await this.prisma.$transaction(async (tx) => {
      const tournament = await this.lockTournament(tx, tournamentId);
      if (tournament.status !== 'PUBLISHED') throw new NotFoundException('Tournament not found');
      this.assertRegistrationOpen(tournament);
      this.assertRulesAccepted(tournament, input.rulesVersion);

      const existing = await tx.registration.findUnique({
        where: { tournamentId_teamId: { tournamentId, teamId: input.teamId } },
      });
      if (existing && existing.status !== 'WITHDRAWN') {
        throw new DomainError(
          'ALREADY_REGISTERED',
          'This team is already registered for the tournament',
          409,
          {
            registrationId: existing.id,
          },
        );
      }
      if (existing) await tx.registration.delete({ where: { id: existing.id } });
      await this.assertCapacity(tx, tournament);

      const registration = await tx.registration.create({
        data: {
          organizationId: tournament.organizationId,
          tournamentId,
          teamId: input.teamId,
          submittedById: userId,
          status: 'DRAFT',
        },
      });
      await this.applyRoster(
        tx,
        tournament,
        registration.id,
        input.teamId,
        input.members,
        userId,
        input.rulesVersion,
      );
      return registration.id;
    });
    return this.dto(id);
  }

  /** Correct a roster before approval; re-runs validation (VALIDATION_FAILED → SUBMITTED). */
  async updateRoster(
    userId: string,
    registrationId: string,
    input: UpdateRosterInput,
  ): Promise<RegistrationDto> {
    const registration = await this.prisma.registration.findUnique({
      where: { id: registrationId },
    });
    if (!registration) throw new NotFoundException('Registration not found');
    await this.teams.requireManager(userId, registration.teamId);
    await this.prisma.$transaction(async (tx) => {
      const tournament = await this.lockTournament(tx, registration.tournamentId);
      const current = await tx.registration.findUniqueOrThrow({ where: { id: registrationId } });
      if (!EDITABLE_ROSTER.includes(current.status)) {
        throw new DomainError('ROSTER_LOCKED', 'The roster is locked for this registration', 409);
      }
      this.assertRegistrationOpen(tournament);
      this.assertRulesAccepted(tournament, input.rulesVersion);
      await tx.registrationMember.deleteMany({ where: { registrationId } });
      await tx.registration.update({ where: { id: registrationId }, data: { status: 'DRAFT' } });
      await this.applyRoster(
        tx,
        tournament,
        registrationId,
        current.teamId,
        input.members,
        userId,
        input.rulesVersion,
      );
    });
    return this.dto(registrationId);
  }

  async withdraw(userId: string, registrationId: string): Promise<RegistrationDto> {
    const registration = await this.prisma.registration.findUnique({
      where: { id: registrationId },
    });
    if (!registration) throw new NotFoundException('Registration not found');
    await this.teams.requireManager(userId, registration.teamId);
    await this.prisma.$transaction(async (tx) => {
      const tournament = await this.lockTournament(tx, registration.tournamentId);
      if (tournament.status === 'IN_PROGRESS' || tournament.status === 'COMPLETED') {
        throw new DomainError(
          'TOURNAMENT_STARTED',
          'Teams cannot withdraw after the tournament has started',
          409,
        );
      }
      await this.move(tx, registrationId, 'WITHDRAWN');
      await tx.registrationMember.deleteMany({ where: { registrationId } });
    });
    return this.dto(registrationId);
  }

  async mine(userId: string): Promise<RegistrationDto[]> {
    const rows = await this.prisma.registration.findMany({
      where: { team: { members: { some: { leftAt: null, player: { userId } } } } },
      include: registrationInclude,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toDto);
  }

  async getForTeamMember(userId: string, registrationId: string): Promise<RegistrationDto> {
    const row = await this.prisma.registration.findFirst({
      where: {
        id: registrationId,
        team: { members: { some: { leftAt: null, player: { userId } } } },
      },
      include: registrationInclude,
    });
    if (!row) throw new NotFoundException('Registration not found');
    return toDto(row);
  }

  // ───────────────────────────── Organizer side ─────────────────────────────

  async list(user: AuthUser, orgId: string, tournamentId: string, status?: RegistrationStatus) {
    await this.authorize(
      user,
      orgId,
      tournamentId,
      ['OWNER', 'ADMIN', 'REFEREE', 'VIEWER'],
      ['ADMIN', 'REFEREE'],
    );
    const rows = await this.prisma.registration.findMany({
      where: { tournamentId, organizationId: orgId, ...(status ? { status } : {}) },
      include: registrationInclude,
      orderBy: [{ seed: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toDto);
  }

  async startReview(user: AuthUser, orgId: string, tournamentId: string, registrationId: string) {
    await this.authorize(user, orgId, tournamentId, ['OWNER', 'ADMIN'], ['ADMIN']);
    await this.prisma.$transaction(async (tx) => {
      await this.lockTournament(tx, tournamentId);
      const reg = await this.loadForTournament(tx, tournamentId, registrationId);
      await this.move(tx, reg.id, 'UNDER_REVIEW', { reviewedById: user.id });
      await this.auditDecision(tx, orgId, user.id, reg.id, reg.status, 'UNDER_REVIEW');
    });
    return this.dto(registrationId);
  }

  async approve(user: AuthUser, orgId: string, tournamentId: string, registrationId: string) {
    await this.authorize(user, orgId, tournamentId, ['OWNER', 'ADMIN'], ['ADMIN']);
    await this.prisma.$transaction(async (tx) => {
      const tournament = await this.lockTournament(tx, tournamentId);
      const reg = await this.loadForTournament(tx, tournamentId, registrationId);
      await this.assertCapacity(tx, tournament);
      await this.move(tx, reg.id, 'APPROVED', { reviewedById: user.id, reviewedAt: new Date() });
      await this.auditDecision(tx, orgId, user.id, reg.id, reg.status, 'APPROVED');
      await this.emitDecision(tx, tournament, reg.id, reg.teamId, 'RegistrationApproved');
    });
    return this.dto(registrationId);
  }

  async reject(
    user: AuthUser,
    orgId: string,
    tournamentId: string,
    registrationId: string,
    reason: string,
  ) {
    await this.authorize(user, orgId, tournamentId, ['OWNER', 'ADMIN'], ['ADMIN']);
    await this.prisma.$transaction(async (tx) => {
      const tournament = await this.lockTournament(tx, tournamentId);
      const reg = await this.loadForTournament(tx, tournamentId, registrationId);
      await this.move(tx, reg.id, 'REJECTED', {
        reviewedById: user.id,
        reviewedAt: new Date(),
        rejectionReason: reason,
      });
      await tx.registrationMember.deleteMany({ where: { registrationId: reg.id } });
      await this.auditDecision(tx, orgId, user.id, reg.id, reg.status, 'REJECTED', reason);
      await this.emitDecision(tx, tournament, reg.id, reg.teamId, 'RegistrationRejected', reason);
    });
    return this.dto(registrationId);
  }

  // ───────────────────────────── Internals ─────────────────────────────

  /** Validates the roster and moves DRAFT → SUBMITTED → (VALIDATION_FAILED | APPROVED | stays SUBMITTED). */
  private async applyRoster(
    tx: Tx,
    tournament: Tournament,
    registrationId: string,
    teamId: string,
    entries: RosterEntry[],
    userId: string,
    rulesVersion: number,
  ): Promise<void> {
    const candidates = await this.loadCandidates(tx, tournament, registrationId, teamId, entries);
    const errors = validateRoster(entries, candidates, {
      teamSize: tournament.teamSize,
      maxSubstitutes: tournament.maxSubstitutes,
      minAge: tournament.minAge,
      now: tournament.startsAt,
    });

    await this.move(tx, registrationId, 'SUBMITTED', {
      submittedById: userId,
      rulesAcceptedAt: new Date(),
      rulesVersion,
      validationErrors: [],
    });
    await this.outbox.emit(tx, {
      type: 'RegistrationSubmitted',
      aggregateType: 'Registration',
      aggregateId: registrationId,
      organizationId: tournament.organizationId,
      payload: { registrationId, tournamentId: tournament.id, teamId },
    });

    if (errors.length > 0) {
      await this.move(tx, registrationId, 'VALIDATION_FAILED', {
        validationErrors: errors as unknown as Prisma.InputJsonValue,
      });
      return;
    }
    await tx.registrationMember.createMany({
      data: entries.map((e) => ({
        registrationId,
        tournamentId: tournament.id,
        playerId: e.playerId,
        role: e.role,
        gameAccountId: candidates.get(e.playerId)!.gameAccountId,
      })),
    });
    if (!tournament.requireApproval) {
      await this.assertCapacity(tx, tournament);
      await this.move(tx, registrationId, 'APPROVED', { reviewedAt: new Date() });
      await this.emitDecision(tx, tournament, registrationId, teamId, 'RegistrationApproved');
    }
  }

  private async loadCandidates(
    tx: Tx,
    tournament: Tournament,
    registrationId: string,
    teamId: string,
    entries: RosterEntry[],
  ): Promise<Map<string, RosterCandidate>> {
    const ids = entries.map((e) => e.playerId);
    const players = await tx.player.findMany({
      where: { id: { in: ids } },
      include: {
        teamMemberships: { where: { teamId, leftAt: null } },
        gameAccounts: { where: { gameId: tournament.gameId } },
        registrationMembers: {
          where: { tournamentId: tournament.id, registrationId: { not: registrationId } },
        },
      },
    });
    return new Map(
      players.map((p) => [
        p.id,
        {
          playerId: p.id,
          displayName: p.displayName,
          teamRole: p.teamMemberships[0]?.role ?? null,
          active: p.teamMemberships[0]?.active ?? false,
          status: p.status,
          dateOfBirth: p.dateOfBirth,
          gameAccountId: p.gameAccounts[0]?.id ?? null,
          otherRegistration: p.registrationMembers.length > 0,
        },
      ]),
    );
  }

  private async move(
    tx: Tx,
    registrationId: string,
    to: RegistrationStatus,
    data: Prisma.RegistrationUncheckedUpdateManyInput = {},
  ): Promise<void> {
    const current = await tx.registration.findUniqueOrThrow({ where: { id: registrationId } });
    assertTransition(registrationMachine, current.status, to);
    const updated = await tx.registration.updateMany({
      where: { id: registrationId, version: current.version },
      data: { ...data, status: to, version: { increment: 1 } },
    });
    if (updated.count === 0)
      throw new DomainError('STALE_VERSION', 'Registration changed concurrently; retry', 409);
  }

  private async assertCapacity(tx: Tx, tournament: Tournament): Promise<void> {
    const taken = await tx.registration.count({
      where: { tournamentId: tournament.id, status: { in: HOLDS_SLOT } },
    });
    if (taken >= tournament.maxTeams)
      throw new DomainError('TOURNAMENT_FULL', 'The tournament is full', 409);
  }

  private assertRegistrationOpen(t: Tournament): void {
    const now = new Date();
    if (now < t.registrationOpensAt || now > t.registrationClosesAt) {
      throw new DomainError('REGISTRATION_CLOSED', 'Registration is not open', 409);
    }
  }

  private assertRulesAccepted(t: Tournament, rulesVersion: number): void {
    if (rulesVersion !== t.rulesVersion) {
      throw new DomainError(
        'RULES_OUTDATED',
        'The rules have changed; review and accept the latest version',
        409,
        {
          rulesVersion: t.rulesVersion,
        },
      );
    }
  }

  /** Serializes capacity-sensitive changes per tournament. */
  private async lockTournament(tx: Tx, tournamentId: string): Promise<Tournament> {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM tournaments WHERE id = ${tournamentId}::uuid FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundException('Tournament not found');
    return tx.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
  }

  private async loadForTournament(tx: Tx, tournamentId: string, registrationId: string) {
    const reg = await tx.registration.findFirst({ where: { id: registrationId, tournamentId } });
    if (!reg) throw new NotFoundException('Registration not found');
    return reg;
  }

  private async authorize(
    user: AuthUser,
    orgId: string,
    tournamentId: string,
    orgRoles: Parameters<AccessService['assertTournamentAccess']>[2],
    staffRoles: Parameters<AccessService['assertTournamentAccess']>[3],
  ): Promise<void> {
    const access = await this.access.assertTournamentAccess(
      user,
      tournamentId,
      orgRoles,
      staffRoles,
    );
    if (access.orgId !== orgId) throw new ForbiddenException();
  }

  private async auditDecision(
    tx: Tx,
    orgId: string,
    actorId: string,
    registrationId: string,
    from: string,
    to: string,
    reason?: string,
  ) {
    await this.audit.record(tx, {
      organizationId: orgId,
      actorId,
      action: 'registration.status_changed',
      entity: 'Registration',
      entityId: registrationId,
      oldValue: { status: from },
      newValue: { status: to },
      reason,
    });
  }

  private async emitDecision(
    tx: Tx,
    tournament: Tournament,
    registrationId: string,
    teamId: string,
    type: 'RegistrationApproved' | 'RegistrationRejected',
    reason?: string,
  ) {
    await this.outbox.emit(tx, {
      type,
      aggregateType: 'Registration',
      aggregateId: registrationId,
      organizationId: tournament.organizationId,
      payload: {
        registrationId,
        tournamentId: tournament.id,
        tournamentName: tournament.name,
        teamId,
        reason,
      },
    });
  }

  private async dto(id: string): Promise<RegistrationDto> {
    return toDto(
      await this.prisma.registration.findUniqueOrThrow({
        where: { id },
        include: registrationInclude,
      }),
    );
  }
}

export function toDto(r: RegistrationRow): RegistrationDto {
  return {
    id: r.id,
    tournamentId: r.tournamentId,
    tournamentName: r.tournament.name,
    teamId: r.teamId,
    teamName: r.team.name,
    status: r.status,
    seed: r.seed,
    rulesVersion: r.rulesVersion,
    validationErrors: (r.validationErrors as RosterValidationError[] | null) ?? [],
    rejectionReason: r.rejectionReason,
    checkedInAt: r.checkedInAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    version: r.version,
    members: r.members.map((m) => ({
      playerId: m.playerId,
      displayName: m.player.displayName,
      role: m.role,
      gameAccountId: m.gameAccountId,
      gameUsername: m.gameAccount?.username ?? null,
    })),
  };
}

export { ACTIVE as ACTIVE_REGISTRATION };

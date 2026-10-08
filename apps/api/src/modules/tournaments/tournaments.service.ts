import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  assertTransition,
  COMPETITIVE_FIELDS,
  LIVE_EDITABLE_FIELDS,
  scheduleIssues,
  slugify,
  tournamentMachine,
  tournamentSettingsSchema,
  type AssignStaffInput,
  type CreateTournamentInput,
  type TournamentDto,
  type TournamentStatus,
  type UpdateTournamentInput,
} from '@arenacore/shared';
import { randomBytes } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.service.js';
import { DomainError } from '../../common/errors/domain-error.js';
import { OutboxService } from '../../common/outbox/outbox.service.js';
import type { TenantContext } from '../../common/tenant/tenant.types.js';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service.js';
import type { Game, Tournament } from '../../generated/prisma/client.js';

const SETTINGS_FIELDS = Object.keys(
  tournamentSettingsSchema.shape,
) as (keyof CreateTournamentInput)[];
const ALL_ACTIVE_REGISTRATION = [
  'SUBMITTED',
  'VALIDATION_FAILED',
  'UNDER_REVIEW',
  'APPROVED',
  'CHECKED_IN',
] as const;

@Injectable()
export class TournamentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async create(tenant: TenantContext, input: CreateTournamentInput): Promise<TournamentDto> {
    await this.assertGame(input.gameId);
    const tournament = await this.prisma.$transaction(async (tx) => {
      const created = await tx.tournament.create({
        data: {
          ...input,
          organizationId: tenant.orgId,
          createdById: tenant.userId,
          slug: await this.uniqueSlug(tx, input.name),
        },
      });
      await this.audit.record(tx, {
        organizationId: tenant.orgId,
        actorId: tenant.userId,
        action: 'tournament.created',
        entity: 'Tournament',
        entityId: created.id,
        newValue: input,
      });
      return created;
    });
    return this.get(tenant, tournament.id);
  }

  async list(tenant: TenantContext, status?: TournamentStatus): Promise<TournamentDto[]> {
    const rows = await this.prisma.tournament.findMany({
      where: { organizationId: tenant.orgId, ...(status ? { status } : {}) },
      include: { game: true },
      orderBy: { startsAt: 'desc' },
    });
    const counts = await this.registrationCounts(rows.map((r) => r.id));
    return rows.map((t) => toDto(t, counts.get(t.id) ?? {}));
  }

  async get(tenant: TenantContext, tournamentId: string): Promise<TournamentDto> {
    const t = await this.prisma.tournament.findFirst({
      where: { id: tournamentId, organizationId: tenant.orgId },
      include: { game: true },
    });
    if (!t) throw new NotFoundException('Tournament not found');
    const counts = await this.registrationCounts([t.id]);
    return toDto(t, counts.get(t.id) ?? {});
  }

  /** Applies a partial update with optimistic locking and the status-dependent field lock. */
  async update(
    tenant: TenantContext,
    tournamentId: string,
    input: UpdateTournamentInput,
  ): Promise<TournamentDto> {
    const { version, ...changes } = input;
    await this.prisma.$transaction(async (tx) => {
      const current = await this.load(tx, tenant, tournamentId);
      if (current.version !== version) throw staleVersion();
      const counts = (await this.registrationCounts([current.id], tx)).get(current.id) ?? {};
      const locked = new Set<string>(lockedFields(current, counts));
      const changed = SETTINGS_FIELDS.filter(
        (field) =>
          field in changes && !sameValue(changes[field], current[field as keyof Tournament]),
      );
      const blocked = changed.filter((f) => locked.has(f));
      if (blocked.length > 0) {
        throw new DomainError('SETTINGS_LOCKED', 'Some settings can no longer be changed', 409, {
          fields: blocked,
        });
      }
      if (changed.length === 0) return;
      if (changes.gameId) await this.assertGame(changes.gameId);

      const merged = { ...current, ...changes };
      const issues = scheduleIssues(merged);
      if (issues.length > 0)
        throw new DomainError('INVALID_SCHEDULE', 'The schedule is inconsistent', 422, {
          errors: issues,
        });
      const activeTeams = activeCount(counts);
      if (merged.maxTeams < activeTeams) {
        throw new DomainError(
          'CAPACITY_BELOW_REGISTRATIONS',
          `There are already ${activeTeams} active registrations`,
          409,
        );
      }

      const data = Object.fromEntries(changed.map((f) => [f, changes[f]]));
      const rulesChanged = changed.includes('rules');
      const updated = await tx.tournament.updateMany({
        where: { id: current.id, version },
        data: {
          ...data,
          version: { increment: 1 },
          ...(rulesChanged ? { rulesVersion: { increment: 1 } } : {}),
        },
      });
      if (updated.count === 0) throw staleVersion();
      await this.audit.record(tx, {
        organizationId: tenant.orgId,
        actorId: tenant.userId,
        action: 'tournament.updated',
        entity: 'Tournament',
        entityId: current.id,
        oldValue: Object.fromEntries(changed.map((f) => [f, current[f as keyof Tournament]])),
        newValue: data,
      });
    });
    return this.get(tenant, tournamentId);
  }

  /** TOUR-08 */
  async publish(tenant: TenantContext, tournamentId: string): Promise<TournamentDto> {
    await this.prisma.$transaction(async (tx) => {
      const t = await this.load(tx, tenant, tournamentId);
      assertTransition(tournamentMachine, t.status, 'PUBLISHED');
      const problems = scheduleIssues(t);
      if (!t.rules.trim())
        problems.push({
          path: 'rules',
          message: 'Tournament rules are required before publishing',
        });
      if (t.registrationClosesAt <= new Date()) {
        problems.push({
          path: 'registrationClosesAt',
          message: 'Registration must close in the future',
        });
      }
      if (problems.length > 0) {
        throw new DomainError('NOT_PUBLISHABLE', 'Tournament is not ready to publish', 422, {
          errors: problems,
        });
      }
      await this.transition(tx, tenant, t, 'PUBLISHED', { publishedAt: new Date() });
      await this.outbox.emit(tx, {
        type: 'TournamentPublished',
        aggregateType: 'Tournament',
        aggregateId: t.id,
        organizationId: tenant.orgId,
        payload: { tournamentId: t.id, name: t.name, slug: t.slug },
      });
    });
    return this.get(tenant, tournamentId);
  }

  async unpublish(tenant: TenantContext, tournamentId: string): Promise<TournamentDto> {
    await this.prisma.$transaction(async (tx) => {
      const t = await this.load(tx, tenant, tournamentId);
      assertTransition(tournamentMachine, t.status, 'DRAFT');
      const active = await tx.registration.count({
        where: { tournamentId: t.id, status: { in: [...ALL_ACTIVE_REGISTRATION] } },
      });
      if (active > 0) {
        throw new DomainError(
          'HAS_REGISTRATIONS',
          'Cannot unpublish a tournament that has registrations',
          409,
        );
      }
      await this.transition(tx, tenant, t, 'DRAFT', { publishedAt: null });
    });
    return this.get(tenant, tournamentId);
  }

  async cancel(
    tenant: TenantContext,
    tournamentId: string,
    reason: string,
  ): Promise<TournamentDto> {
    await this.prisma.$transaction(async (tx) => {
      const t = await this.load(tx, tenant, tournamentId);
      assertTransition(tournamentMachine, t.status, 'CANCELLED');
      await this.transition(tx, tenant, t, 'CANCELLED', {}, reason);
      await tx.match.updateMany({
        where: { tournamentId: t.id, status: { notIn: ['COMPLETED', 'FORFEITED', 'CANCELLED'] } },
        data: { status: 'CANCELLED', version: { increment: 1 } },
      });
      await this.outbox.emit(tx, {
        type: 'TournamentCancelled',
        aggregateType: 'Tournament',
        aggregateId: t.id,
        organizationId: tenant.orgId,
        payload: { tournamentId: t.id, name: t.name, reason },
      });
    });
    return this.get(tenant, tournamentId);
  }

  /** TOUR-07: copies configuration into a new draft. */
  async clone(tenant: TenantContext, tournamentId: string, name?: string): Promise<TournamentDto> {
    const source = await this.prisma.tournament.findFirst({
      where: { id: tournamentId, organizationId: tenant.orgId },
    });
    if (!source) throw new NotFoundException('Tournament not found');
    const settings = Object.fromEntries(
      SETTINGS_FIELDS.map((f) => [f, source[f as keyof Tournament]]),
    ) as CreateTournamentInput;
    const copy = await this.prisma.$transaction(async (tx) => {
      const newName = name ?? `${source.name} (copy)`;
      const created = await tx.tournament.create({
        data: {
          ...settings,
          name: newName,
          organizationId: tenant.orgId,
          createdById: tenant.userId,
          slug: await this.uniqueSlug(tx, newName),
        },
      });
      await this.audit.record(tx, {
        organizationId: tenant.orgId,
        actorId: tenant.userId,
        action: 'tournament.cloned',
        entity: 'Tournament',
        entityId: created.id,
        newValue: { sourceTournamentId: source.id, name: newName },
      });
      return created;
    });
    return this.get(tenant, copy.id);
  }

  async staff(tenant: TenantContext, tournamentId: string) {
    await this.ensureExists(tenant, tournamentId);
    const staff = await this.prisma.tournamentStaff.findMany({
      where: { tournamentId },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
    return staff.map((s) => ({
      userId: s.userId,
      displayName: s.user.displayName,
      email: s.user.email,
      role: s.role,
    }));
  }

  /** Resource-scoped grant, e.g. a referee who may only act on this tournament. */
  async assignStaff(
    tenant: TenantContext,
    tournamentId: string,
    input: AssignStaffInput,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.load(tx, tenant, tournamentId);
      const member = await tx.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: tenant.orgId, userId: input.userId } },
      });
      if (!member)
        throw new DomainError('NOT_A_MEMBER', 'Staff must be members of the organization', 422);
      await tx.tournamentStaff.upsert({
        where: { tournamentId_userId: { tournamentId, userId: input.userId } },
        update: { role: input.role },
        create: { tournamentId, userId: input.userId, role: input.role },
      });
      await this.audit.record(tx, {
        organizationId: tenant.orgId,
        actorId: tenant.userId,
        action: 'tournament.staff_assigned',
        entity: 'Tournament',
        entityId: tournamentId,
        newValue: input,
      });
    });
  }

  async removeStaff(tenant: TenantContext, tournamentId: string, userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.load(tx, tenant, tournamentId);
      const removed = await tx.tournamentStaff.deleteMany({ where: { tournamentId, userId } });
      if (removed.count === 0) throw new NotFoundException('Staff assignment not found');
      await this.audit.record(tx, {
        organizationId: tenant.orgId,
        actorId: tenant.userId,
        action: 'tournament.staff_removed',
        entity: 'Tournament',
        entityId: tournamentId,
        oldValue: { userId },
      });
    });
  }

  private async transition(
    tx: Tx,
    tenant: TenantContext,
    t: Tournament,
    to: TournamentStatus,
    extra: Partial<Pick<Tournament, 'publishedAt'>>,
    reason?: string,
  ): Promise<void> {
    const updated = await tx.tournament.updateMany({
      where: { id: t.id, version: t.version, status: t.status },
      data: { status: to, ...extra, version: { increment: 1 } },
    });
    if (updated.count === 0) throw staleVersion();
    await this.audit.record(tx, {
      organizationId: tenant.orgId,
      actorId: tenant.userId,
      action: `tournament.status_changed`,
      entity: 'Tournament',
      entityId: t.id,
      oldValue: { status: t.status },
      newValue: { status: to },
      reason,
    });
  }

  private async load(tx: Tx, tenant: TenantContext, tournamentId: string): Promise<Tournament> {
    const [t] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM tournaments WHERE id = ${tournamentId}::uuid AND "organizationId" = ${tenant.orgId}::uuid FOR UPDATE`;
    if (!t) throw new NotFoundException('Tournament not found');
    return tx.tournament.findUniqueOrThrow({ where: { id: t.id } });
  }

  private async ensureExists(tenant: TenantContext, tournamentId: string): Promise<void> {
    const count = await this.prisma.tournament.count({
      where: { id: tournamentId, organizationId: tenant.orgId },
    });
    if (count === 0) throw new NotFoundException('Tournament not found');
  }

  private async assertGame(gameId: string): Promise<void> {
    const game = await this.prisma.game.findUnique({ where: { id: gameId } });
    if (!game?.active) throw new DomainError('UNKNOWN_GAME', 'Unsupported game', 422);
  }

  private async registrationCounts(
    ids: string[],
    tx: Tx = this.prisma,
  ): Promise<Map<string, Record<string, number>>> {
    const grouped = await tx.registration.groupBy({
      by: ['tournamentId', 'status'],
      where: { tournamentId: { in: ids } },
      _count: { _all: true },
    });
    const map = new Map<string, Record<string, number>>();
    for (const row of grouped) {
      const entry = map.get(row.tournamentId) ?? {};
      entry[row.status] = row._count._all;
      map.set(row.tournamentId, entry);
    }
    return map;
  }

  private async uniqueSlug(tx: Tx, name: string): Promise<string> {
    const base = slugify(name) || 'tournament';
    if (!(await tx.tournament.findUnique({ where: { slug: base } }))) return base;
    return `${base}-${randomBytes(3).toString('hex')}`;
  }
}

function activeCount(counts: Record<string, number>): number {
  return ALL_ACTIVE_REGISTRATION.reduce((sum, s) => sum + (counts[s] ?? 0), 0);
}

export function lockedFields(
  t: Pick<Tournament, 'status'>,
  counts: Record<string, number>,
): string[] {
  if (t.status === 'COMPLETED' || t.status === 'CANCELLED') return [...SETTINGS_FIELDS];
  if (t.status === 'IN_PROGRESS') {
    return SETTINGS_FIELDS.filter((f) => !(LIVE_EDITABLE_FIELDS as readonly string[]).includes(f));
  }
  if (t.status === 'PUBLISHED' && activeCount(counts) > 0) return [...COMPETITIVE_FIELDS];
  return [];
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  return (a ?? null) === (b ?? null);
}

function staleVersion(): ConflictException {
  return new ConflictException({
    message: 'Tournament was modified by someone else; reload and retry',
    code: 'STALE_VERSION',
  });
}

function toDto(t: Tournament & { game: Game }, counts: Record<string, number>): TournamentDto {
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return {
    id: t.id,
    organizationId: t.organizationId,
    gameId: t.gameId,
    gameName: t.game.name,
    name: t.name,
    slug: t.slug,
    description: t.description,
    region: t.region,
    platform: t.platform,
    format: t.format,
    teamSize: t.teamSize,
    maxSubstitutes: t.maxSubstitutes,
    maxTeams: t.maxTeams,
    bestOf: t.bestOf,
    finalsBestOf: t.finalsBestOf,
    grandFinalReset: t.grandFinalReset,
    requireApproval: t.requireApproval,
    minAge: t.minAge,
    registrationOpensAt: t.registrationOpensAt.toISOString(),
    registrationClosesAt: t.registrationClosesAt.toISOString(),
    checkInOpensAt: iso(t.checkInOpensAt),
    checkInClosesAt: iso(t.checkInClosesAt),
    startsAt: t.startsAt.toISOString(),
    matchCheckInMinutes: t.matchCheckInMinutes,
    status: t.status,
    rules: t.rules,
    rulesVersion: t.rulesVersion,
    prizeInfo: t.prizeInfo,
    publishedAt: iso(t.publishedAt),
    version: t.version,
    registrationCounts: counts,
    lockedFields: lockedFields(t, counts),
  };
}

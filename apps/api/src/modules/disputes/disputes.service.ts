import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  assertTransition,
  canTransition,
  disputeMachine,
  EVIDENCE_MIME_TYPES,
  matchMachine,
  MAX_EVIDENCE_BYTES,
  seriesWinner,
  type AddEvidenceInput,
  type DisputeDto,
  type EvidenceLinkInput,
  type EvidenceUploadRequest,
  type ListDisputesQuery,
  type OpenDisputeInput,
  type ResolveDisputeInput,
} from '@arenacore/shared';
import { randomUUID } from 'node:crypto';
import type { AuthUser } from '../../common/auth/auth.types.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { DomainError } from '../../common/errors/domain-error.js';
import { OutboxService } from '../../common/outbox/outbox.service.js';
import { AccessService } from '../../common/tenant/access.service.js';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service.js';
import { StorageService } from '../../infra/storage/storage.service.js';
import type { Dispute, Match, MatchSlot, Prisma } from '../../generated/prisma/client.js';
import { BracketStore } from '../competition/bracket-store.js';
import { lockMatch, sideForUser } from '../matches/match-access.js';
import { MatchesService, type MatchDetailDto } from '../matches/matches.service.js';
import { ResultsService } from '../matches/results.service.js';
import { DisputeFactory } from './dispute-factory.js';
import { matchesDeclaredType } from './file-signature.js';

const OPEN_STATES = ['OPEN', 'ASSIGNED', 'INVESTIGATING'] as const;
const DISPUTABLE_MATCH = [
  'READY',
  'IN_PROGRESS',
  'RESULT_PENDING',
  'NO_SHOW_REVIEW',
  'COMPLETED',
  'FORFEITED',
  'CHECK_IN_OPEN',
  'SCHEDULED',
];
const STAFF_READ = {
  org: ['OWNER', 'ADMIN', 'REFEREE', 'VIEWER'] as const,
  staff: ['ADMIN', 'REFEREE'] as const,
};

const disputeInclude = {
  tournament: { select: { name: true } },
  match: { select: { key: true } },
  assignedTo: { select: { displayName: true } },
  evidence: { orderBy: { createdAt: 'asc' } },
  decision: true,
} satisfies Prisma.DisputeInclude;
type DisputeRow = Prisma.DisputeGetPayload<{ include: typeof disputeInclude }>;

@Injectable()
export class DisputesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly factory: DisputeFactory,
    private readonly results: ResultsService,
    private readonly matches: MatchesService,
    private readonly store: BracketStore,
    private readonly storage: StorageService,
  ) {}

  // ───────────────────────────── Players ─────────────────────────────

  async open(userId: string, matchId: string, input: OpenDisputeInput): Promise<DisputeDto> {
    const id = await this.prisma.$transaction(async (tx) => {
      const match = await lockMatch(tx, matchId);
      const side = await sideForUser(tx, matchId, userId);
      const existing = await tx.dispute.findFirst({
        where: { matchId, status: { in: [...OPEN_STATES] } },
      });
      if (existing)
        throw new DomainError('DISPUTE_EXISTS', 'This match already has an open dispute', 409, {
          disputeId: existing.id,
        });
      if (match.isBye || !DISPUTABLE_MATCH.includes(match.status)) {
        throw new DomainError(
          'MATCH_NOT_DISPUTABLE',
          `A ${match.status.toLowerCase()} match cannot be disputed`,
          409,
        );
      }

      const before = match.status;
      if (canTransition(matchMachine, match.status, 'DISPUTED'))
        await this.setMatchStatus(tx, match, 'DISPUTED');
      const dispute = await this.factory.open(tx, {
        match,
        reason: input.reason,
        description: input.description,
        openedById: userId,
        openedBySlot: side.slot,
        matchStatusBefore: before,
      });
      await this.addLinks(tx, dispute.id, userId, input.evidence);
      return dispute.id;
    });
    return this.dto(id);
  }

  async mine(userId: string): Promise<DisputeDto[]> {
    const rows = await this.prisma.dispute.findMany({
      where: {
        match: {
          participants: {
            some: { team: { members: { some: { leftAt: null, player: { userId } } } } },
          },
        },
      },
      include: disputeInclude,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toDto);
  }

  async get(user: AuthUser, disputeId: string): Promise<DisputeDto> {
    await this.assertCanView(user, disputeId);
    return this.dto(disputeId);
  }

  async withdraw(userId: string, disputeId: string): Promise<DisputeDto> {
    await this.prisma.$transaction(async (tx) => {
      const dispute = await this.lockDispute(tx, disputeId);
      if (dispute.openedById !== userId)
        throw new ForbiddenException('Only the player who opened the dispute can withdraw it');
      assertTransition(disputeMachine, dispute.status, 'WITHDRAWN');
      const match = await lockMatch(tx, dispute.matchId);
      await this.restoreMatch(tx, match, dispute);
      await tx.dispute.update({
        where: { id: dispute.id },
        data: { status: 'WITHDRAWN', resolvedAt: new Date(), version: { increment: 1 } },
      });
    });
    return this.dto(disputeId);
  }

  // ───────────────────────────── Evidence ─────────────────────────────

  async requestUpload(user: AuthUser, disputeId: string, input: EvidenceUploadRequest) {
    const dispute = await this.assertCanView(user, disputeId);
    this.assertOpen(dispute);
    const storageKey = `disputes/${disputeId}/${randomUUID()}.${EVIDENCE_MIME_TYPES[input.contentType]}`;
    const uploadUrl = await this.storage.presignUpload(
      this.storage.evidenceBucket,
      storageKey,
      input.contentType,
      input.sizeBytes,
    );
    return {
      uploadUrl,
      storageKey,
      kind: input.kind,
      contentType: input.contentType,
      expiresIn: 300,
    };
  }

  /** Records a link, a note, or a previously uploaded file after verifying its real type and size. */
  async addEvidence(
    user: AuthUser,
    disputeId: string,
    input: AddEvidenceInput,
  ): Promise<DisputeDto> {
    const dispute = await this.assertCanView(user, disputeId);
    this.assertOpen(dispute);
    if ('storageKey' in input) {
      if (!input.storageKey.startsWith(`disputes/${disputeId}/`)) {
        throw new DomainError(
          'INVALID_EVIDENCE',
          'That upload does not belong to this dispute',
          422,
        );
      }
      const object = await this.storage.head(this.storage.evidenceBucket, input.storageKey);
      if (!object)
        throw new DomainError('UPLOAD_MISSING', 'Upload the file before attaching it', 422);
      const declared = Object.entries(EVIDENCE_MIME_TYPES).find(([, ext]) =>
        input.storageKey.endsWith(`.${ext}`),
      )?.[0];
      const size = object.sizeBytes ?? 0;
      const prefix = declared
        ? await this.storage.readPrefix(this.storage.evidenceBucket, input.storageKey)
        : Buffer.alloc(0);
      if (!declared || size > MAX_EVIDENCE_BYTES || !matchesDeclaredType(declared, prefix)) {
        throw new DomainError(
          'INVALID_EVIDENCE',
          'The uploaded file does not match an allowed evidence type',
          422,
        );
      }
      await this.prisma.disputeEvidence.create({
        data: {
          disputeId,
          uploadedById: user.id,
          kind: input.kind,
          storageKey: input.storageKey,
          contentType: declared,
          sizeBytes: size,
        },
      });
    } else {
      await this.prisma.$transaction((tx) => this.addLinks(tx, disputeId, user.id, [input]));
    }
    return this.dto(disputeId);
  }

  async downloadUrl(
    user: AuthUser,
    disputeId: string,
    evidenceId: string,
  ): Promise<{ url: string; expiresIn: number }> {
    await this.assertCanView(user, disputeId);
    const evidence = await this.prisma.disputeEvidence.findFirst({
      where: { id: evidenceId, disputeId },
    });
    if (!evidence?.storageKey) throw new NotFoundException('Evidence file not found');
    return {
      url: await this.storage.presignDownload(this.storage.evidenceBucket, evidence.storageKey),
      expiresIn: 300,
    };
  }

  // ───────────────────────────── Referees ─────────────────────────────

  async list(user: AuthUser, orgId: string, query: ListDisputesQuery): Promise<DisputeDto[]> {
    const rows = await this.prisma.dispute.findMany({
      where: {
        organizationId: orgId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.tournamentId ? { tournamentId: query.tournamentId } : {}),
        ...(query.assignedToMe ? { assignedToId: user.id } : {}),
      },
      include: disputeInclude,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toDto);
  }

  /** Referee workspace: the dispute plus every result, report and piece of evidence for the match. */
  async workspace(
    user: AuthUser,
    orgId: string,
    disputeId: string,
  ): Promise<{ dispute: DisputeDto; match: MatchDetailDto }> {
    const dispute = await this.findInOrg(orgId, disputeId);
    await this.access.assertTournamentAccess(
      user,
      dispute.tournamentId,
      STAFF_READ.org,
      STAFF_READ.staff,
    );
    return {
      dispute: await this.dto(disputeId),
      match: await this.matches.buildDetail(dispute.matchId),
    };
  }

  /** Admins assign any eligible referee; referees can only claim a dispute for themselves. */
  async assign(
    user: AuthUser,
    orgId: string,
    disputeId: string,
    refereeUserId?: string,
  ): Promise<DisputeDto> {
    const dispute = await this.findInOrg(orgId, disputeId);
    const access = await this.access.assertTournamentAccess(
      user,
      dispute.tournamentId,
      ['OWNER', 'ADMIN', 'REFEREE'],
      ['ADMIN', 'REFEREE'],
    );
    const isAdmin =
      access.staffRole === 'ADMIN' ||
      (access.staffRole === null && (access.role === 'OWNER' || access.role === 'ADMIN'));
    const assignee = refereeUserId ?? user.id;
    if (!isAdmin && assignee !== user.id)
      throw new ForbiddenException('Referees can only assign disputes to themselves');
    if (assignee !== user.id)
      await this.assertEligibleReferee(dispute.tournamentId, orgId, assignee);

    await this.prisma.$transaction(async (tx) => {
      const current = await this.lockDispute(tx, disputeId);
      assertTransition(disputeMachine, current.status, 'ASSIGNED');
      await tx.dispute.update({
        where: { id: disputeId },
        data: { status: 'ASSIGNED', assignedToId: assignee, version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        organizationId: orgId,
        actorId: user.id,
        action: 'dispute.assigned',
        entity: 'Dispute',
        entityId: disputeId,
        oldValue: { status: current.status, assignedToId: current.assignedToId },
        newValue: { status: 'ASSIGNED', assignedToId: assignee },
      });
      await this.outbox.emit(tx, {
        type: 'DisputeAssigned',
        aggregateType: 'Dispute',
        aggregateId: disputeId,
        organizationId: orgId,
        payload: { disputeId, matchId: current.matchId, assignedToId: assignee },
      });
    });
    return this.dto(disputeId);
  }

  async startInvestigation(user: AuthUser, orgId: string, disputeId: string): Promise<DisputeDto> {
    const dispute = await this.findInOrg(orgId, disputeId);
    await this.assertDecisionMaker(user, dispute);
    await this.prisma.$transaction(async (tx) => {
      const current = await this.lockDispute(tx, disputeId);
      assertTransition(disputeMachine, current.status, 'INVESTIGATING');
      await tx.dispute.update({
        where: { id: disputeId },
        data: { status: 'INVESTIGATING', version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        organizationId: orgId,
        actorId: user.id,
        action: 'dispute.investigating',
        entity: 'Dispute',
        entityId: disputeId,
        oldValue: { status: current.status },
        newValue: { status: 'INVESTIGATING' },
      });
    });
    return this.dto(disputeId);
  }

  /**
   * The referee's ruling. A human always makes this decision; the bracket is recalculated in the
   * same transaction and every change is audited.
   */
  async resolve(
    user: AuthUser,
    orgId: string,
    disputeId: string,
    input: ResolveDisputeInput,
  ): Promise<DisputeDto> {
    const dispute = await this.findInOrg(orgId, disputeId);
    await this.assertDecisionMaker(user, dispute);

    await this.prisma.$transaction(async (tx) => {
      const current = await this.lockDispute(tx, disputeId);
      assertTransition(disputeMachine, current.status, 'RESOLVED');
      let match = await lockMatch(tx, current.matchId);
      const before = {
        status: match.status,
        winnerSlot: match.winnerSlot,
        scoreA: match.scoreA,
        scoreB: match.scoreB,
      };
      const stage = await this.store.lock(tx, match.stageId);
      const hasResult = stage.settings.state.matches[match.key]?.status === 'completed';

      let winnerSlot: MatchSlot | null = null;
      switch (input.outcome) {
        case 'UPHOLD_RESULT':
        case 'DISMISSED':
          if (input.outcome === 'UPHOLD_RESULT' && !hasResult) {
            throw new DomainError(
              'NO_RESULT_TO_UPHOLD',
              'There is no recorded result to uphold; overturn or replay instead',
              422,
            );
          }
          await this.restoreMatch(tx, match, current);
          winnerSlot = match.winnerSlot;
          break;
        case 'OVERTURN_RESULT':
        case 'FORFEIT': {
          const forfeited = input.outcome === 'FORFEIT';
          winnerSlot = forfeited
            ? input.winnerSlot!
            : seriesWinner(match.bestOf, input.scoreA!, input.scoreB!);
          if (!winnerSlot)
            throw new DomainError(
              'INVALID_SCORE',
              `Scores do not decide a best-of-${match.bestOf}`,
              422,
            );
          if (hasResult) await this.store.reset(tx, stage, match.key);
          await tx.matchResult.updateMany({
            where: { matchId: match.id, status: { not: 'SUPERSEDED' } },
            data: { status: 'SUPERSEDED' },
          });
          await tx.matchResult.create({
            data: {
              matchId: match.id,
              source: 'ADMIN',
              externalRef: `dispute:${disputeId}`,
              reportedById: user.id,
              scoreA: input.scoreA ?? 0,
              scoreB: input.scoreB ?? 0,
              winnerSlot,
              status: 'CONFIRMED',
              note: input.ruling,
            },
          });
          match = await tx.match.findUniqueOrThrow({ where: { id: match.id } });
          if (
            match.status !== 'DISPUTED' &&
            canTransition(matchMachine, match.status, 'DISPUTED')
          ) {
            match = await this.setMatchStatus(tx, match, 'DISPUTED');
          }
          await this.results.complete(tx, match, {
            scoreA: forfeited ? null : input.scoreA!,
            scoreB: forfeited ? null : input.scoreB!,
            winnerSlot,
            source: 'ADMIN',
            forfeited,
          });
          break;
        }
        case 'REPLAY':
          if (hasResult) await this.store.reset(tx, stage, match.key);
          await tx.matchResult.updateMany({
            where: { matchId: match.id, status: { not: 'SUPERSEDED' } },
            data: { status: 'SUPERSEDED' },
          });
          await tx.match.update({
            where: { id: match.id },
            data: {
              status: 'READY',
              scoreA: null,
              scoreB: null,
              winnerSlot: null,
              winnerTeamId: null,
              resultSource: null,
              completedAt: null,
              version: { increment: 1 },
            },
          });
          break;
      }

      await tx.disputeDecision.create({
        data: {
          disputeId,
          decidedById: user.id,
          outcome: input.outcome,
          winnerSlot,
          scoreA: input.scoreA ?? null,
          scoreB: input.scoreB ?? null,
          ruling: input.ruling,
        },
      });
      await tx.dispute.update({
        where: { id: disputeId },
        data: {
          status: 'RESOLVED',
          resolvedAt: new Date(),
          assignedToId: current.assignedToId ?? user.id,
          version: { increment: 1 },
        },
      });
      const after = await tx.match.findUniqueOrThrow({ where: { id: match.id } });
      await this.audit.record(tx, {
        organizationId: orgId,
        actorId: user.id,
        action: 'dispute.resolved',
        entity: 'Dispute',
        entityId: disputeId,
        oldValue: { disputeStatus: current.status, match: before },
        newValue: {
          outcome: input.outcome,
          match: {
            status: after.status,
            winnerSlot: after.winnerSlot,
            scoreA: after.scoreA,
            scoreB: after.scoreB,
          },
        },
        reason: input.ruling,
      });
      await this.outbox.emit(tx, {
        type: 'DisputeResolved',
        aggregateType: 'Dispute',
        aggregateId: disputeId,
        organizationId: orgId,
        payload: {
          disputeId,
          matchId: match.id,
          tournamentId: match.tournamentId,
          outcome: input.outcome,
          winnerSlot,
        },
      });
    });
    return this.dto(disputeId);
  }

  // ───────────────────────────── Internals ─────────────────────────────

  /** Puts a disputed match back where it was when the dispute was opened. */
  private async restoreMatch(tx: Tx, match: Match, dispute: Dispute): Promise<void> {
    if (match.status !== 'DISPUTED') return;
    const target =
      dispute.matchStatusBefore &&
      canTransition(matchMachine, 'DISPUTED', dispute.matchStatusBefore)
        ? dispute.matchStatusBefore
        : match.winnerSlot
          ? 'COMPLETED'
          : 'RESULT_PENDING';
    if (target === 'RESULT_PENDING') {
      await tx.matchResult.updateMany({
        where: { matchId: match.id, status: 'CONFLICTED' },
        data: { status: 'SUPERSEDED' },
      });
    }
    await this.setMatchStatus(tx, match, target);
  }

  private async setMatchStatus(tx: Tx, match: Match, to: Match['status']): Promise<Match> {
    assertTransition(matchMachine, match.status, to);
    const updated = await tx.match.updateMany({
      where: { id: match.id, version: match.version },
      data: { status: to, version: { increment: 1 } },
    });
    if (updated.count === 0)
      throw new DomainError('STALE_VERSION', 'Match changed concurrently; retry', 409);
    return tx.match.findUniqueOrThrow({ where: { id: match.id } });
  }

  private async addLinks(
    tx: Tx,
    disputeId: string,
    userId: string,
    links: EvidenceLinkInput[] | undefined,
  ) {
    if (!links?.length) return;
    await tx.disputeEvidence.createMany({
      data: links.map((l) => ({
        disputeId,
        uploadedById: userId,
        kind: l.kind,
        url: l.url,
        text: l.text,
      })),
    });
  }

  private async assertCanView(user: AuthUser, disputeId: string): Promise<Dispute> {
    const dispute = await this.prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute) throw new NotFoundException('Dispute not found');
    const participant = await this.prisma.matchParticipant.count({
      where: {
        matchId: dispute.matchId,
        team: { members: { some: { leftAt: null, player: { userId: user.id } } } },
      },
    });
    if (!participant)
      await this.access.assertTournamentAccess(
        user,
        dispute.tournamentId,
        STAFF_READ.org,
        STAFF_READ.staff,
      );
    return dispute;
  }

  /** The assigned referee, or an organizer admin, may rule. */
  private async assertDecisionMaker(user: AuthUser, dispute: Dispute): Promise<void> {
    const access = await this.access.assertTournamentAccess(
      user,
      dispute.tournamentId,
      ['OWNER', 'ADMIN', 'REFEREE'],
      ['ADMIN', 'REFEREE'],
    );
    const isAdmin =
      access.staffRole === 'ADMIN' ||
      (access.staffRole === null && (access.role === 'OWNER' || access.role === 'ADMIN'));
    if (!isAdmin && dispute.assignedToId !== user.id) {
      throw new ForbiddenException(
        'Only the assigned referee or an admin can work on this dispute',
      );
    }
  }

  private async assertEligibleReferee(
    tournamentId: string,
    orgId: string,
    userId: string,
  ): Promise<void> {
    const [member, staff] = await Promise.all([
      this.prisma.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: orgId, userId } },
      }),
      this.prisma.tournamentStaff.findUnique({
        where: { tournamentId_userId: { tournamentId, userId } },
      }),
    ]);
    const eligible = (member && member.role !== 'VIEWER') || staff;
    if (!eligible)
      throw new DomainError('NOT_A_REFEREE', 'That user cannot referee this tournament', 422);
  }

  private assertOpen(dispute: Dispute): void {
    if (!(OPEN_STATES as readonly string[]).includes(dispute.status)) {
      throw new DomainError(
        'DISPUTE_CLOSED',
        'Evidence can only be added while the dispute is open',
        409,
      );
    }
  }

  private async lockDispute(tx: Tx, disputeId: string): Promise<Dispute> {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM disputes WHERE id = ${disputeId}::uuid FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundException('Dispute not found');
    return tx.dispute.findUniqueOrThrow({ where: { id: disputeId } });
  }

  private async findInOrg(orgId: string, disputeId: string): Promise<Dispute> {
    const dispute = await this.prisma.dispute.findFirst({
      where: { id: disputeId, organizationId: orgId },
    });
    if (!dispute) throw new NotFoundException('Dispute not found');
    return dispute;
  }

  private async dto(id: string): Promise<DisputeDto> {
    return toDto(
      await this.prisma.dispute.findUniqueOrThrow({ where: { id }, include: disputeInclude }),
    );
  }
}

function toDto(d: DisputeRow): DisputeDto {
  return {
    id: d.id,
    tournamentId: d.tournamentId,
    tournamentName: d.tournament.name,
    matchId: d.matchId,
    matchKey: d.match.key,
    reason: d.reason,
    description: d.description,
    status: d.status,
    openedBySlot: d.openedBySlot,
    openedById: d.openedById,
    assignedToId: d.assignedToId,
    assignedToName: d.assignedTo?.displayName ?? null,
    createdAt: d.createdAt.toISOString(),
    resolvedAt: d.resolvedAt?.toISOString() ?? null,
    version: d.version,
    evidence: d.evidence.map((e) => ({
      id: e.id,
      kind: e.kind,
      url: e.url,
      text: e.text,
      storageKey: e.storageKey,
      contentType: e.contentType,
      sizeBytes: e.sizeBytes,
      uploadedById: e.uploadedById,
      createdAt: e.createdAt.toISOString(),
    })),
    decision: d.decision
      ? {
          outcome: d.decision.outcome,
          winnerSlot: d.decision.winnerSlot,
          scoreA: d.decision.scoreA,
          scoreB: d.decision.scoreB,
          ruling: d.decision.ruling,
          decidedById: d.decision.decidedById,
          createdAt: d.decision.createdAt.toISOString(),
        }
      : null,
  };
}

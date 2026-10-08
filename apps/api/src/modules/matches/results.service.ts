import { Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import {
  assertTransition,
  matchMachine,
  seriesWinner,
  type AdminResultInput,
  type ApiEnv,
  type EvidenceLinkInput,
  type MatchSummaryDto,
  type ReportResultInput,
} from '@arenacore/shared';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { AuthUser } from '../../common/auth/auth.types.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { DomainError } from '../../common/errors/domain-error.js';
import { OutboxService } from '../../common/outbox/outbox.service.js';
import { AccessService } from '../../common/tenant/access.service.js';
import { API_ENV } from '../../config/config.module.js';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service.js';
import {
  Prisma,
  type Match,
  type MatchSlot,
  type ResultSource,
} from '../../generated/prisma/client.js';
import { matchSummaryInclude, toMatchSummary } from '../competition/bracket-query.service.js';
import { BracketStore } from '../competition/bracket-store.js';
import { DisputeFactory } from '../disputes/dispute-factory.js';
import { assertNotFrozen, lockMatch, sideForUser } from './match-access.js';
import { GameProviderRegistry } from './providers/game-provider.js';

const REPORTABLE = ['READY', 'IN_PROGRESS', 'RESULT_PENDING'];
const other = (slot: MatchSlot): MatchSlot => (slot === 'A' ? 'B' : 'A');

export interface FinalResult {
  scoreA: number | null;
  scoreB: number | null;
  winnerSlot: MatchSlot;
  source: ResultSource;
  forfeited: boolean;
}

@Injectable()
export class ResultsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly store: BracketStore,
    private readonly disputes: DisputeFactory,
    private readonly providers: GameProviderRegistry,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  /**
   * Captain-reported score. Matching reports from both sides confirm the result and advance the
   * bracket; conflicting reports move the match to DISPUTED and open a dispute automatically.
   */
  async report(
    userId: string,
    matchId: string,
    input: ReportResultInput,
  ): Promise<MatchSummaryDto> {
    await this.prisma.$transaction(async (tx) => {
      const match = await lockMatch(tx, matchId);
      const side = await sideForUser(tx, matchId, userId);
      if (!REPORTABLE.includes(match.status)) {
        throw new DomainError(
          'MATCH_NOT_REPORTABLE',
          `Results cannot be reported while the match is ${match.status}`,
          409,
        );
      }
      await assertNotFrozen(tx, match);
      const winnerSlot = seriesWinner(match.bestOf, input.scoreA, input.scoreB);
      if (!winnerSlot) {
        throw new DomainError(
          'INVALID_SCORE',
          `A best-of-${match.bestOf} needs exactly ${Math.ceil(match.bestOf / 2)} wins for the winner`,
          422,
        );
      }

      const ref = `side:${side.slot}`;
      const own = await tx.matchResult.findUnique({
        where: { matchId_source_externalRef: { matchId, source: 'PARTICIPANT', externalRef: ref } },
      });
      if (
        own &&
        own.status === 'SUBMITTED' &&
        own.scoreA === input.scoreA &&
        own.scoreB === input.scoreB
      )
        return;
      // Superseded reports (after a replay or ruling) are reused for the new report.
      if (own && own.status !== 'SUBMITTED' && own.status !== 'SUPERSEDED') {
        throw new DomainError('RESULT_LOCKED', 'Your report has already been processed', 409);
      }
      const data = {
        scoreA: input.scoreA,
        scoreB: input.scoreB,
        winnerSlot,
        reportedById: userId,
        reportedBySlot: side.slot,
        status: 'SUBMITTED' as const,
      };
      const mine = own
        ? await tx.matchResult.update({ where: { id: own.id }, data })
        : await tx.matchResult.create({
            data: { ...data, matchId, source: 'PARTICIPANT', externalRef: ref },
          });
      await this.saveEvidence(tx, matchId, userId, input.evidence);

      const theirs = await tx.matchResult.findUnique({
        where: {
          matchId_source_externalRef: {
            matchId,
            source: 'PARTICIPANT',
            externalRef: `side:${other(side.slot)}`,
          },
        },
      });
      if (!theirs || theirs.status !== 'SUBMITTED') {
        if (match.status !== 'RESULT_PENDING') await this.setStatus(tx, match, 'RESULT_PENDING');
        await this.outbox.emit(tx, {
          type: 'ResultReported',
          aggregateType: 'Match',
          aggregateId: matchId,
          organizationId: match.organizationId,
          payload: {
            matchId,
            tournamentId: match.tournamentId,
            reportedBySlot: side.slot,
            scoreA: input.scoreA,
            scoreB: input.scoreB,
          },
        });
        return;
      }
      if (theirs.scoreA === mine.scoreA && theirs.scoreB === mine.scoreB) {
        await tx.matchResult.updateMany({
          where: { id: { in: [mine.id, theirs.id] } },
          data: { status: 'CONFIRMED' },
        });
        await this.complete(tx, match, {
          scoreA: input.scoreA,
          scoreB: input.scoreB,
          winnerSlot,
          source: 'PARTICIPANT',
          forfeited: false,
        });
        return;
      }
      await tx.matchResult.updateMany({
        where: { id: { in: [mine.id, theirs.id] } },
        data: { status: 'CONFLICTED' },
      });
      await this.setStatus(
        tx,
        await tx.match.findUniqueOrThrow({ where: { id: matchId } }),
        'DISPUTED',
      );
      await this.disputes.open(tx, {
        match,
        reason: 'INCORRECT_RESULT',
        description: `Conflicting score reports: A reported ${scoreText(side.slot === 'A' ? mine : theirs)}, B reported ${scoreText(side.slot === 'B' ? mine : theirs)}.`,
        openedById: null,
        openedBySlot: null,
        matchStatusBefore: 'RESULT_PENDING',
      });
    });
    return this.summary(matchId);
  }

  /** Referee/admin result entry, forfeits and overrides of already-applied results. */
  async adminResult(
    user: AuthUser,
    orgId: string,
    matchId: string,
    input: AdminResultInput,
  ): Promise<MatchSummaryDto> {
    const found = await this.prisma.match.findFirst({
      where: { id: matchId, organizationId: orgId },
    });
    if (!found) throw new NotFoundException('Match not found');
    await this.access.assertTournamentAccess(
      user,
      found.tournamentId,
      ['OWNER', 'ADMIN'],
      ['ADMIN', 'REFEREE'],
    );

    await this.prisma.$transaction(async (tx) => {
      let match = await lockMatch(tx, matchId);
      const before = {
        status: match.status,
        scoreA: match.scoreA,
        scoreB: match.scoreB,
        winnerSlot: match.winnerSlot,
      };
      const winnerSlot = input.forfeitBy
        ? other(input.forfeitBy)
        : seriesWinner(match.bestOf, input.scoreA!, input.scoreB!);
      if (!winnerSlot)
        throw new DomainError(
          'INVALID_SCORE',
          `Scores do not decide a best-of-${match.bestOf}`,
          422,
        );

      if (match.status === 'COMPLETED' || match.status === 'FORFEITED') {
        if (match.isBye)
          throw new DomainError('BYE_MATCH', 'Bye matches have no result to change', 409);
        if (!input.override) {
          throw new DomainError(
            'RESULT_EXISTS',
            'This match already has a result; set override to replace it',
            409,
          );
        }
        const stage = await this.store.lock(tx, match.stageId);
        await this.store.reset(tx, stage, match.key);
        await tx.matchResult.updateMany({
          where: { matchId, status: { not: 'SUPERSEDED' } },
          data: { status: 'SUPERSEDED' },
        });
        match = await tx.match.findUniqueOrThrow({ where: { id: matchId } });
      } else {
        await tx.matchResult.updateMany({
          where: { matchId, status: { in: ['SUBMITTED', 'CONFLICTED'] } },
          data: { status: 'SUPERSEDED' },
        });
      }

      await tx.matchResult.create({
        data: {
          matchId,
          source: 'ADMIN',
          externalRef: `admin:${randomUUID()}`,
          reportedById: user.id,
          scoreA: input.scoreA ?? 0,
          scoreB: input.scoreB ?? 0,
          winnerSlot,
          status: 'CONFIRMED',
          note: input.reason,
        },
      });
      await this.complete(tx, match, {
        scoreA: input.scoreA ?? null,
        scoreB: input.scoreB ?? null,
        winnerSlot,
        source: 'ADMIN',
        forfeited: !!input.forfeitBy,
      });
      await this.audit.record(tx, {
        organizationId: orgId,
        actorId: user.id,
        action: input.forfeitBy ? 'match.forfeit_awarded' : 'match.result_set',
        entity: 'Match',
        entityId: matchId,
        oldValue: before,
        newValue: {
          scoreA: input.scoreA ?? null,
          scoreB: input.scoreB ?? null,
          winnerSlot,
          forfeitBy: input.forfeitBy ?? null,
        },
        reason: input.reason,
      });
    });
    return this.summary(matchId);
  }

  /**
   * Trusted game-provider callback. Duplicate deliveries collapse on (match, GAME_API, eventId),
   * so retries never produce a second result.
   */
  async ingestWebhook(
    providerKey: string,
    rawBody: Buffer | undefined,
    signature: string | undefined,
    body: unknown,
  ) {
    this.verifySignature(rawBody, signature);
    const provider = this.providers.get(providerKey);
    if (!provider) throw new NotFoundException('Unknown game provider');
    const payload = provider.parseResultWebhook(body);

    return this.prisma.$transaction(async (tx) => {
      const located = await tx.match.findFirst({
        where: { externalMatchId: payload.externalMatchId, status: { not: 'CANCELLED' } },
      });
      if (!located) throw new NotFoundException('No match is linked to that external match id');
      const match = await lockMatch(tx, located.id);
      const winnerSlot = seriesWinner(match.bestOf, payload.scoreA, payload.scoreB);
      if (!winnerSlot)
        throw new DomainError('INVALID_SCORE', 'Provider scores do not decide the series', 422);

      const created = await tx.matchResult
        .create({
          data: {
            matchId: match.id,
            source: 'GAME_API',
            externalRef: payload.eventId,
            scoreA: payload.scoreA,
            scoreB: payload.scoreB,
            winnerSlot,
            note: `provider:${providerKey}`,
          },
        })
        .catch((error: unknown) => {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
            return null;
          throw error;
        });
      if (!created) return { status: 'duplicate' as const, matchId: match.id };

      if (match.status === 'COMPLETED' || match.status === 'FORFEITED') {
        const agrees = match.winnerSlot === winnerSlot;
        await tx.matchResult.update({
          where: { id: created.id },
          data: { status: agrees ? 'CONFIRMED' : 'CONFLICTED' },
        });
        if (!agrees) {
          await this.setStatus(tx, match, 'DISPUTED');
          await this.disputes.open(tx, {
            match,
            reason: 'INCORRECT_RESULT',
            description: `Game data (${payload.scoreA}-${payload.scoreB}) contradicts the recorded result.`,
            openedById: null,
            openedBySlot: null,
            matchStatusBefore: match.status,
          });
        }
        return {
          status: agrees ? ('already_applied' as const) : ('disputed' as const),
          matchId: match.id,
        };
      }
      if (!REPORTABLE.includes(match.status) && match.status !== 'DISPUTED') {
        throw new DomainError('MATCH_NOT_REPORTABLE', `Match is ${match.status}`, 409);
      }
      await tx.matchResult.updateMany({
        where: {
          matchId: match.id,
          source: 'PARTICIPANT',
          status: { in: ['SUBMITTED', 'CONFLICTED'] },
        },
        data: { status: 'SUPERSEDED' },
      });
      await tx.matchResult.update({ where: { id: created.id }, data: { status: 'CONFIRMED' } });
      await this.complete(tx, match, {
        scoreA: payload.scoreA,
        scoreB: payload.scoreB,
        winnerSlot,
        source: 'GAME_API',
        forfeited: false,
      });
      return { status: 'applied' as const, matchId: match.id };
    });
  }

  /** Persists the final result and advances the bracket atomically. */
  async complete(tx: Tx, match: Match, result: FinalResult): Promise<void> {
    const to = result.forfeited ? 'FORFEITED' : 'COMPLETED';
    assertTransition(matchMachine, match.status, to);
    const stage = await this.store.lock(tx, match.stageId);
    const updated = await tx.match.updateMany({
      where: { id: match.id, version: match.version },
      data: {
        status: to,
        scoreA: result.scoreA,
        scoreB: result.scoreB,
        resultSource: result.source,
        completedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (updated.count === 0)
      throw new DomainError('STALE_VERSION', 'Match changed concurrently; retry', 409);
    const outcome = await this.store.applyWinner(tx, stage, match.key, result.winnerSlot);

    const participants = await tx.matchParticipant.findMany({ where: { matchId: match.id } });
    const winner = participants.find((p) => p.slot === result.winnerSlot);
    const loser = participants.find((p) => p.slot !== result.winnerSlot);
    await this.outbox.emit(tx, {
      type: 'MatchCompleted',
      aggregateType: 'Match',
      aggregateId: match.id,
      organizationId: match.organizationId,
      payload: {
        matchId: match.id,
        tournamentId: match.tournamentId,
        key: match.key,
        scoreA: result.scoreA,
        scoreB: result.scoreB,
        winnerSlot: result.winnerSlot,
        winnerRegistrationId: winner?.registrationId ?? null,
        loserRegistrationId: loser?.registrationId ?? null,
        forfeited: result.forfeited,
        source: result.source,
      },
    });
    if (winner && match.winnerToMatchId) {
      await this.outbox.emit(tx, {
        type: 'TeamAdvanced',
        aggregateType: 'Registration',
        aggregateId: winner.registrationId,
        organizationId: match.organizationId,
        payload: {
          registrationId: winner.registrationId,
          tournamentId: match.tournamentId,
          fromMatchId: match.id,
          toMatchId: match.winnerToMatchId,
          readyMatchIds: outcome.readyMatchIds,
        },
      });
    }
  }

  private async setStatus(tx: Tx, match: Match, to: Match['status']): Promise<void> {
    assertTransition(matchMachine, match.status, to);
    const updated = await tx.match.updateMany({
      where: { id: match.id, version: match.version },
      data: { status: to, version: { increment: 1 } },
    });
    if (updated.count === 0)
      throw new DomainError('STALE_VERSION', 'Match changed concurrently; retry', 409);
  }

  private async saveEvidence(
    tx: Tx,
    matchId: string,
    userId: string,
    evidence: EvidenceLinkInput[] | undefined,
  ) {
    if (!evidence?.length) return;
    await tx.matchEvidence.createMany({
      data: evidence.map((e) => ({
        matchId,
        uploadedById: userId,
        kind: e.kind,
        url: e.url,
        text: e.text,
      })),
    });
  }

  private verifySignature(rawBody: Buffer | undefined, signature: string | undefined): void {
    const expected = `sha256=${createHmac('sha256', this.env.GAME_WEBHOOK_SECRET)
      .update(rawBody ?? Buffer.alloc(0))
      .digest('hex')}`;
    const given = Buffer.from(signature ?? '');
    const want = Buffer.from(expected);
    if (!rawBody || given.length !== want.length || !timingSafeEqual(given, want)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
  }

  async summary(matchId: string): Promise<MatchSummaryDto> {
    return toMatchSummary(
      await this.prisma.match.findUniqueOrThrow({
        where: { id: matchId },
        include: matchSummaryInclude,
      }),
    );
  }
}

function scoreText(r: { scoreA: number; scoreB: number }): string {
  return `${r.scoreA}-${r.scoreB}`;
}

import { Injectable, NotFoundException } from '@nestjs/common';
import {
  applyResult,
  champion,
  createState,
  generateBracket,
  resetResult,
  standings,
  type BracketPlan,
  type BracketState,
  type Side,
} from '@arenacore/bracket';
import { OutboxService } from '../../common/outbox/outbox.service.js';
import type { Tx } from '../../infra/prisma/prisma.service.js';
import type { Match, Prisma, Stage, Tournament } from '../../generated/prisma/client.js';

/**
 * Engine state lives in Stage.settings; Match/MatchParticipant/Standing rows are its projection.
 * Every change happens under a row lock on the stage, inside the caller's transaction, so the
 * two never diverge and concurrent results for the same bracket are serialized.
 */
export interface StageSettings {
  /** Registration ids in seed order (index 0 = seed 1). */
  participants: string[];
  grandFinalReset: boolean;
  state: BracketState;
}

export interface LoadedStage {
  stage: Stage;
  tournament: Tournament;
  plan: BracketPlan;
  settings: StageSettings;
}

export interface SyncResult {
  readyMatchIds: string[];
  championRegistrationId: string | null;
}

const ACTIVE_OPERATIONAL = [
  'SCHEDULED',
  'CHECK_IN_OPEN',
  'CHECK_IN_EXPIRED',
  'NO_SHOW_REVIEW',
  'READY',
  'IN_PROGRESS',
  'RESULT_PENDING',
  'DISPUTED',
];

@Injectable()
export class BracketStore {
  constructor(private readonly outbox: OutboxService) {}

  planFor(
    tournament: Pick<Tournament, 'format' | 'grandFinalReset'>,
    participantCount: number,
  ): BracketPlan {
    return generateBracket(tournament.format, participantCount, {
      grandFinalReset: tournament.grandFinalReset,
    });
  }

  /** Creates stage, rounds, matches (with DAG edges) and standings, resolving byes immediately. */
  async create(
    tx: Tx,
    tournament: Tournament,
    seededRegistrationIds: string[],
  ): Promise<LoadedStage> {
    const plan = this.planFor(tournament, seededRegistrationIds.length);
    const state = createState(plan, seededRegistrationIds);
    const settings: StageSettings = {
      participants: seededRegistrationIds,
      grandFinalReset: tournament.grandFinalReset,
      state: emptyProjectionState(plan),
    };
    const stage = await tx.stage.create({
      data: {
        organizationId: tournament.organizationId,
        tournamentId: tournament.id,
        name: 'Main Bracket',
        format: tournament.format,
        status: 'IN_PROGRESS',
        settings: settings as unknown as Prisma.InputJsonValue,
      },
    });

    const finalKeys = new Set(
      plan.matches.filter((m) => isFinalMatch(plan, m.key)).map((m) => m.key),
    );
    const roundIds = new Map<string, string>();
    for (const round of plan.rounds) {
      const finals = plan.matches.some(
        (m) => m.bracket === round.bracket && m.round === round.number && finalKeys.has(m.key),
      );
      const created = await tx.round.create({
        data: {
          stageId: stage.id,
          bracket: round.bracket,
          number: round.number,
          name: round.name,
          bestOf: finals ? (tournament.finalsBestOf ?? tournament.bestOf) : tournament.bestOf,
        },
      });
      roundIds.set(`${round.bracket}:${round.number}`, created.id);
    }

    const ids = new Map<string, string>();
    for (const m of plan.matches) {
      const created = await tx.match.create({
        data: {
          organizationId: tournament.organizationId,
          tournamentId: tournament.id,
          stageId: stage.id,
          roundId: roundIds.get(`${m.bracket}:${m.round}`)!,
          key: m.key,
          bracket: m.bracket,
          roundNumber: m.round,
          position: m.position,
          bestOf: finalKeys.has(m.key)
            ? (tournament.finalsBestOf ?? tournament.bestOf)
            : tournament.bestOf,
        },
      });
      ids.set(m.key, created.id);
    }
    for (const m of plan.matches) {
      if (!m.winnerTo && !m.loserTo) continue;
      await tx.match.update({
        where: { id: ids.get(m.key)! },
        data: {
          winnerToMatchId: m.winnerTo ? ids.get(m.winnerTo.match) : null,
          winnerToSlot: m.winnerTo?.side ?? null,
          loserToMatchId: m.loserTo ? ids.get(m.loserTo.match) : null,
          loserToSlot: m.loserTo?.side ?? null,
        },
      });
    }

    const registrations = await tx.registration.findMany({
      where: { id: { in: seededRegistrationIds } },
    });
    await tx.standing.createMany({
      data: registrations.map((r) => ({
        tournamentId: tournament.id,
        registrationId: r.id,
        teamId: r.teamId,
      })),
    });

    const loaded: LoadedStage = { stage, tournament, plan, settings };
    await this.sync(
      tx,
      loaded,
      state,
      plan.matches.map((m) => m.key),
    );
    return loaded;
  }

  async lock(tx: Tx, stageId: string): Promise<LoadedStage> {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM stages WHERE id = ${stageId}::uuid FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundException('Stage not found');
    const stage = await tx.stage.findUniqueOrThrow({
      where: { id: stageId },
      include: { tournament: true },
    });
    const settings = stage.settings as unknown as StageSettings;
    return {
      stage,
      tournament: stage.tournament,
      plan: this.planFor(stage.tournament, settings.participants.length),
      settings,
    };
  }

  /** Records a winner in the engine and projects every consequence. Idempotent for identical results. */
  async applyWinner(
    tx: Tx,
    loaded: LoadedStage,
    matchKey: string,
    side: Side,
  ): Promise<SyncResult & { changed: boolean }> {
    const outcome = applyResult(loaded.plan, loaded.settings.state, matchKey, side);
    if (!outcome.changed)
      return { changed: false, readyMatchIds: [], championRegistrationId: null };
    return { changed: true, ...(await this.sync(tx, loaded, outcome.state, outcome.affected)) };
  }

  /** Clears a result and everything downstream; returns the keys that were affected. */
  async reset(tx: Tx, loaded: LoadedStage, matchKey: string): Promise<string[]> {
    const { state, affected } = resetResult(loaded.plan, loaded.settings.state, matchKey);
    await this.sync(tx, loaded, state, affected);
    return affected;
  }

  private async sync(
    tx: Tx,
    loaded: LoadedStage,
    next: BracketState,
    keys: string[],
  ): Promise<SyncResult> {
    const { stage, tournament, plan, settings } = loaded;
    const previous = settings.state;
    const matches = await tx.match.findMany({ where: { stageId: stage.id, key: { in: keys } } });
    const byKey = new Map(matches.map((m) => [m.key, m]));
    const registrations = await tx.registration.findMany({
      where: { id: { in: settings.participants } },
    });
    const teamOf = new Map(registrations.map((r) => [r.id, r.teamId]));
    const readyMatchIds: string[] = [];
    const now = new Date();

    for (const key of keys) {
      const engine = next.matches[key]!;
      const row = byKey.get(key)!;
      for (const side of ['A', 'B'] as const) {
        const slot = engine[side];
        if (slot.state === 'filled') {
          await tx.matchParticipant.upsert({
            where: { matchId_slot: { matchId: row.id, slot: side } },
            update: { registrationId: slot.id, teamId: teamOf.get(slot.id)!, checkedInAt: null },
            create: {
              matchId: row.id,
              slot: side,
              registrationId: slot.id,
              teamId: teamOf.get(slot.id)!,
            },
          });
        } else {
          await tx.matchParticipant.deleteMany({ where: { matchId: row.id, slot: side } });
        }
      }
      const data = projectMatch(row, engine, tournament, teamOf, now);
      if (data)
        await tx.match.update({
          where: { id: row.id },
          data: { ...data, version: { increment: 1 } },
        });
      if (engine.status === 'ready' && previous.matches[key]?.status !== 'ready') {
        readyMatchIds.push(row.id);
        await this.outbox.emit(tx, {
          type: 'MatchReady',
          aggregateType: 'Match',
          aggregateId: row.id,
          organizationId: tournament.organizationId,
          payload: {
            matchId: row.id,
            tournamentId: tournament.id,
            key,
            registrationIds: [engine.A, engine.B].map((s) => (s.state === 'filled' ? s.id : null)),
          },
        });
      }
    }

    settings.state = next;
    await tx.stage.update({
      where: { id: stage.id },
      data: { settings: settings as unknown as Prisma.InputJsonValue },
    });
    await this.syncStandings(tx, loaded, previous, next);

    const winner = champion(plan, next);
    const hadChampion = champion(plan, previous);
    if (winner && !hadChampion) {
      await tx.stage.update({ where: { id: stage.id }, data: { status: 'COMPLETED' } });
      await tx.tournament.update({
        where: { id: tournament.id },
        data: { status: 'COMPLETED', version: { increment: 1 } },
      });
      await this.outbox.emit(tx, {
        type: 'TournamentCompleted',
        aggregateType: 'Tournament',
        aggregateId: tournament.id,
        organizationId: tournament.organizationId,
        payload: {
          tournamentId: tournament.id,
          name: tournament.name,
          championRegistrationId: winner,
        },
      });
    } else if (!winner && hadChampion) {
      await tx.stage.update({ where: { id: stage.id }, data: { status: 'IN_PROGRESS' } });
      await tx.tournament.update({
        where: { id: tournament.id },
        data: { status: 'IN_PROGRESS', version: { increment: 1 } },
      });
    }
    return { readyMatchIds, championRegistrationId: winner };
  }

  private async syncStandings(
    tx: Tx,
    loaded: LoadedStage,
    previous: BracketState,
    next: BracketState,
  ): Promise<void> {
    const { plan, settings, tournament } = loaded;
    const before = new Map(
      standings(plan, previous, settings.participants).map((r) => [r.participant, r]),
    );
    for (const row of standings(plan, next, settings.participants)) {
      const old = before.get(row.participant);
      if (
        old &&
        old.wins === row.wins &&
        old.losses === row.losses &&
        old.placement === row.placement &&
        old.eliminated === row.eliminated
      ) {
        continue;
      }
      await tx.standing.update({
        where: { registrationId: row.participant },
        data: {
          wins: row.wins,
          losses: row.losses,
          placement: row.placement,
          eliminatedAt: row.eliminated ? new Date() : null,
        },
      });
      if (row.eliminated && !old?.eliminated) {
        await this.outbox.emit(tx, {
          type: 'TeamEliminated',
          aggregateType: 'Registration',
          aggregateId: row.participant,
          organizationId: tournament.organizationId,
          payload: {
            registrationId: row.participant,
            tournamentId: tournament.id,
            placement: row.placement,
          },
        });
      }
    }
  }
}

function projectMatch(
  row: Match,
  engine: BracketState['matches'][string],
  tournament: Tournament,
  teamOf: Map<string, string>,
  now: Date,
): Prisma.MatchUpdateInput | null {
  const winnerTeam = () => {
    const slot = engine.winner ? engine[engine.winner] : null;
    return slot?.state === 'filled' ? teamOf.get(slot.id)! : null;
  };
  switch (engine.status) {
    case 'pending':
      return {
        status: 'PENDING',
        winnerSlot: null,
        winnerTeamId: null,
        scoreA: null,
        scoreB: null,
        resultSource: null,
        completedAt: null,
        startedAt: null,
        isBye: false,
      };
    case 'ready': {
      if (ACTIVE_OPERATIONAL.includes(row.status)) return null;
      if (row.status === 'COMPLETED' || row.status === 'FORFEITED') {
        // A played result was reset (dispute/admin correction): await a new result.
        return {
          status: 'RESULT_PENDING',
          winnerSlot: null,
          winnerTeamId: null,
          scoreA: null,
          scoreB: null,
          resultSource: null,
          completedAt: null,
        };
      }
      const scheduledAt =
        row.scheduledAt ?? new Date(Math.max(now.getTime(), tournament.startsAt.getTime()));
      return {
        status: 'SCHEDULED',
        isBye: false,
        scheduledAt,
        checkInOpensAt: new Date(scheduledAt.getTime() - tournament.matchCheckInMinutes * 60_000),
        checkInDeadline: scheduledAt,
      };
    }
    case 'completed':
      return {
        status: row.status === 'FORFEITED' ? 'FORFEITED' : 'COMPLETED',
        winnerSlot: engine.winner,
        winnerTeamId: winnerTeam(),
        completedAt: row.completedAt ?? now,
      };
    case 'walkover':
      return {
        status: 'COMPLETED',
        isBye: true,
        winnerSlot: engine.winner,
        winnerTeamId: winnerTeam(),
        completedAt: row.completedAt ?? now,
      };
    case 'void':
      return { status: 'CANCELLED', isBye: true, winnerSlot: null, winnerTeamId: null };
  }
}

function isFinalMatch(plan: BracketPlan, key: string): boolean {
  if (plan.format === 'DOUBLE_ELIMINATION') return key.startsWith('GF');
  return key === `W${Math.log2(plan.size)}-1`;
}

/** The "before" state for initial projection: everything pending, so every match gets synced. */
function emptyProjectionState(plan: BracketPlan): BracketState {
  return {
    matches: Object.fromEntries(
      plan.matches.map((m) => [
        m.key,
        { A: { state: 'pending' }, B: { state: 'pending' }, status: 'pending', winner: null },
      ]),
    ),
  };
}

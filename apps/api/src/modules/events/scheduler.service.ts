import { Injectable } from '@nestjs/common';
import { OutboxService } from '../../common/outbox/outbox.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { MatchesService } from '../matches/matches.service.js';

const STARTING_SOON_MS = 15 * 60_000;

/** Time-driven work, run periodically by the worker. Each tick is idempotent. */
@Injectable()
export class SchedulerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matches: MatchesService,
    private readonly outbox: OutboxService,
  ) {}

  async tick(
    now = new Date(),
  ): Promise<{ opened: number; expired: number; startingSoon: number; purged: number }> {
    const checkIns = await this.matches.runCheckInTick(now);
    const startingSoon = await this.announceStartingSoon(now);
    const purged = (
      await this.prisma.idempotencyRecord.deleteMany({ where: { expiresAt: { lt: now } } })
    ).count;
    return { ...checkIns, startingSoon, purged };
  }

  private async announceStartingSoon(now: Date): Promise<number> {
    const upcoming = await this.prisma.match.findMany({
      where: {
        isBye: false,
        scheduledAt: { gt: now, lte: new Date(now.getTime() + STARTING_SOON_MS) },
        status: { in: ['SCHEDULED', 'CHECK_IN_OPEN', 'READY'] },
      },
      select: { id: true, tournamentId: true, organizationId: true, scheduledAt: true },
    });
    let announced = 0;
    for (const match of upcoming) {
      const scheduledAt = match.scheduledAt!.toISOString();
      await this.prisma.$transaction(async (tx) => {
        // One reminder per scheduled time; a reschedule earns a new one.
        const already = await tx.outboxEvent.findFirst({
          where: {
            type: 'MatchStartingSoon',
            aggregateId: match.id,
            payload: { path: ['scheduledAt'], equals: scheduledAt },
          },
        });
        if (already) return;
        await this.outbox.emit(tx, {
          type: 'MatchStartingSoon',
          aggregateType: 'Match',
          aggregateId: match.id,
          organizationId: match.organizationId,
          payload: { matchId: match.id, tournamentId: match.tournamentId, scheduledAt },
        });
        announced += 1;
      });
    }
    return announced;
  }
}

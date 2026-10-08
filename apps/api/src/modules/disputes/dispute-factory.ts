import { Injectable } from '@nestjs/common';
import type { DisputeReason } from '@arenacore/shared';
import { OutboxService } from '../../common/outbox/outbox.service.js';
import type { Tx } from '../../infra/prisma/prisma.service.js';
import type { Dispute, Match, MatchSlot } from '../../generated/prisma/client.js';

export interface OpenDisputeParams {
  match: Match;
  reason: DisputeReason;
  description: string;
  openedById: string | null;
  openedBySlot: MatchSlot | null;
}

/** Creates a dispute and announces it; shared by players, referees and the result pipeline. */
@Injectable()
export class DisputeFactory {
  constructor(private readonly outbox: OutboxService) {}

  async open(tx: Tx, params: OpenDisputeParams): Promise<Dispute> {
    const existing = await tx.dispute.findFirst({
      where: { matchId: params.match.id, status: { in: ['OPEN', 'ASSIGNED', 'INVESTIGATING'] } },
    });
    if (existing) return existing;
    const dispute = await tx.dispute.create({
      data: {
        organizationId: params.match.organizationId,
        tournamentId: params.match.tournamentId,
        matchId: params.match.id,
        reason: params.reason,
        description: params.description,
        openedById: params.openedById,
        openedBySlot: params.openedBySlot,
      },
    });
    await this.outbox.emit(tx, {
      type: 'DisputeOpened',
      aggregateType: 'Dispute',
      aggregateId: dispute.id,
      organizationId: params.match.organizationId,
      payload: {
        disputeId: dispute.id,
        matchId: params.match.id,
        tournamentId: params.match.tournamentId,
        reason: params.reason,
        openedBySlot: params.openedBySlot,
      },
    });
    return dispute;
  }
}

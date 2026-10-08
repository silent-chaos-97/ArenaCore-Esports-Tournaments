import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DomainError } from '../../common/errors/domain-error.js';
import type { Tx } from '../../infra/prisma/prisma.service.js';
import type { Match, MatchSlot } from '../../generated/prisma/client.js';

/** Locks the match row for the rest of the transaction. */
export async function lockMatch(tx: Tx, matchId: string): Promise<Match> {
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM matches WHERE id = ${matchId}::uuid FOR UPDATE`;
  if (rows.length === 0) throw new NotFoundException('Match not found');
  return tx.match.findUniqueOrThrow({ where: { id: matchId } });
}

/** The side the user manages (captain/manager of a participating team). */
export async function sideForUser(
  tx: Tx,
  matchId: string,
  userId: string,
): Promise<{ slot: MatchSlot; registrationId: string; teamId: string }> {
  const participants = await tx.matchParticipant.findMany({
    where: { matchId },
    include: {
      team: {
        include: {
          members: {
            where: { leftAt: null, role: { in: ['CAPTAIN', 'MANAGER'] }, player: { userId } },
          },
        },
      },
    },
  });
  const mine = participants.find((p) => p.team.members.length > 0);
  if (!mine)
    throw new ForbiddenException('Only a captain or manager of a team in this match can do this');
  return { slot: mine.slot, registrationId: mine.registrationId, teamId: mine.teamId };
}

/**
 * Workflow D: while an upstream match feeding this one is disputed, progression into it is frozen.
 */
export async function assertNotFrozen(tx: Tx, match: Match): Promise<void> {
  const disputedFeeder = await tx.match.findFirst({
    where: {
      OR: [{ winnerToMatchId: match.id }, { loserToMatchId: match.id }],
      status: 'DISPUTED',
    },
    select: { key: true },
  });
  if (disputedFeeder) {
    throw new DomainError(
      'PROGRESSION_FROZEN',
      `Waiting for the dispute on ${disputedFeeder.key} to be resolved`,
      409,
    );
  }
}

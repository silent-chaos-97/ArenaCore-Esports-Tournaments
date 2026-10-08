'use client';

import type { MatchSummaryDto } from '@arenacore/shared';
import Link from 'next/link';
import { StatusPill } from '@/components/ui/status';
import { formatDateTime, formatRelative } from '@/lib/format';

const NEEDS_ME: Record<string, string> = {
  CHECK_IN_OPEN: 'Check in now',
  READY: 'Play and report the score',
  RESULT_PENDING: 'Confirm the reported score',
  DISPUTED: 'A referee is reviewing this match',
  NO_SHOW_REVIEW: 'Check-in closed; a referee will decide',
  SCHEDULED: 'Check-in opens before the match',
};

/** The player's next match, given the most prominent spot on their dashboard. */
export function NextMatch({
  match,
  myTeamIds,
}: {
  match: MatchSummaryDto;
  myTeamIds: Set<string>;
}) {
  const mineIsA = !!match.a && myTeamIds.has(match.a.teamId);
  const me = mineIsA ? match.a : match.b;
  const opponent = mineIsA ? match.b : match.a;
  return (
    <Link
      href={`/me/matches/${match.id}`}
      className="group block rounded-lg border-2 border-ink bg-surface p-6 hover:border-cobalt"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[15px] text-muted">
          {match.roundName}, best of {match.bestOf}
        </p>
        <StatusPill status={match.status} />
      </div>
      <p className="mt-3 font-display text-5xl leading-none font-bold sm:text-6xl">
        {me?.teamName ?? 'Your team'}
        <span className="mx-3 text-muted">vs</span>
        {opponent?.teamName ?? 'TBD'}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-[15px]">
        {match.scheduledAt && (
          <span>
            {formatDateTime(match.scheduledAt)}{' '}
            <span className="text-muted">({formatRelative(match.scheduledAt)})</span>
          </span>
        )}
        {match.checkInDeadline && (
          <span className="text-muted">
            Check-in closes {formatDateTime(match.checkInDeadline)}
          </span>
        )}
        <span className="font-semibold text-cobalt group-hover:underline">
          {NEEDS_ME[match.status] ?? 'Open match'}
        </span>
      </div>
    </Link>
  );
}

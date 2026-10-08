'use client';

import type {
  DisputeDto,
  MatchSummaryDto,
  RegistrationDto,
  TeamDto,
  TeamInviteDto,
} from '@arenacore/shared';
import Link from 'next/link';
import { NextMatch } from '@/components/player/next-match';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorNote, Loading } from '@/components/ui/feedback';
import { DataTable, Section, Td } from '@/components/ui/layout';
import { StatusPill } from '@/components/ui/status';
import { useAuth } from '@/lib/auth';
import { formatDateTime, humanize } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';

export default function PlayerDashboard() {
  const { user } = useAuth();
  const matches = useApi<MatchSummaryDto[]>('/matches/mine', {
    key: ['me', 'matches'],
    refetchInterval: 30_000,
  });
  const teams = useApi<TeamDto[]>('/teams/mine', { key: ['me', 'teams'] });
  const registrations = useApi<RegistrationDto[]>('/registrations/mine', {
    key: ['me', 'registrations'],
  });
  const invites = useApi<TeamInviteDto[]>('/players/me/team-invites', { key: ['me', 'invites'] });
  const disputes = useApi<DisputeDto[]>('/disputes/mine', { key: ['me', 'disputes'] });
  const respond = useAction(
    (input: { id: string; accept: boolean }) => ({
      path: `/team-invites/${input.id}/${input.accept ? 'accept' : 'decline'}`,
      method: 'POST',
    }),
    {
      success: 'Invitation answered',
      invalidate: [['me']],
    },
  );

  const myTeamIds = new Set(teams.data?.map((t) => t.id) ?? []);
  const [next, ...later] = matches.data ?? [];

  return (
    <div className="flex flex-col gap-10">
      <h1 className="text-5xl font-bold">Hi, {user?.displayName}</h1>

      {(invites.data?.length ?? 0) > 0 && (
        <Section title="Team invitations">
          <ul className="flex flex-col divide-y divide-rule rounded-lg border border-rule bg-surface">
            {invites.data!.map((i) => (
              <li
                key={i.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <span className="text-[15px]">
                  <span className="font-semibold">{i.teamName}</span> invited you as{' '}
                  {humanize(i.role).toLowerCase()}.
                </span>
                <span className="flex gap-2">
                  <Button onClick={() => respond.mutate({ id: i.id, accept: true })}>
                    Join team
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => respond.mutate({ id: i.id, accept: false })}
                  >
                    Decline
                  </Button>
                </span>
              </li>
            ))}
          </ul>
          <ErrorNote error={respond.error} />
        </Section>
      )}

      <Section title="Your next match">
        {matches.isPending ? (
          <Loading />
        ) : matches.error ? (
          <ErrorNote error={matches.error} />
        ) : next ? (
          <>
            <NextMatch match={next} myTeamIds={myTeamIds} />
            {later.length > 0 && (
              <ul className="flex flex-col gap-1 text-[15px]">
                {later.map((m) => (
                  <li key={m.id}>
                    <Link
                      href={`/me/matches/${m.id}`}
                      className="font-semibold text-cobalt hover:underline"
                    >
                      {m.a?.teamName ?? 'TBD'} vs {m.b?.teamName ?? 'TBD'}
                    </Link>{' '}
                    <span className="text-muted">
                      {m.roundName}, {formatDateTime(m.scheduledAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <EmptyState
            title="No matches scheduled"
            action={
              <Link href="/" className="font-semibold text-cobalt hover:underline">
                Find a tournament
              </Link>
            }
          >
            Matches appear here once a tournament you’ve entered starts and your opponent is known.
          </EmptyState>
        )}
      </Section>

      <Section title="Registrations">
        {registrations.data?.length === 0 ? (
          <EmptyState title="You haven’t entered a tournament yet">
            Captains register their team from a tournament’s page.
          </EmptyState>
        ) : (
          <DataTable head={['Tournament', 'Team', 'Status', '']}>
            {registrations.data?.map((r) => (
              <tr key={r.id}>
                <Td className="font-semibold">{r.tournamentName}</Td>
                <Td>{r.teamName}</Td>
                <Td>
                  <StatusPill status={r.status} />
                  {r.status === 'VALIDATION_FAILED' && (
                    <p className="mt-1 text-sm text-loss">
                      {r.validationErrors.map((e) => e.message).join(' ')}
                    </p>
                  )}
                  {r.status === 'REJECTED' && r.rejectionReason && (
                    <p className="mt-1 text-sm text-muted">{r.rejectionReason}</p>
                  )}
                </Td>
                <Td className="text-right">
                  <RegistrationAction registration={r} />
                </Td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>

      {(disputes.data?.length ?? 0) > 0 && (
        <Section title="Disputes">
          <DataTable head={['Match', 'Reason', 'Status', 'Ruling']}>
            {disputes.data!.map((d) => (
              <tr key={d.id}>
                <Td>
                  <Link
                    href={`/me/matches/${d.matchId}`}
                    className="font-semibold text-cobalt hover:underline"
                  >
                    {d.tournamentName} ({d.matchKey})
                  </Link>
                </Td>
                <Td>{humanize(d.reason)}</Td>
                <Td>
                  <StatusPill status={d.status} />
                </Td>
                <Td className="max-w-sm text-sm">{d.decision?.ruling ?? '—'}</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}
    </div>
  );
}

function RegistrationAction({ registration: r }: { registration: RegistrationDto }) {
  const checkIn = useAction(
    () => ({
      path: `/tournaments/${r.tournamentId}/check-in`,
      method: 'POST',
      body: { teamId: r.teamId },
    }),
    {
      success: 'Checked in',
      invalidate: [['me']],
      idempotent: true,
    },
  );
  if (r.status === 'APPROVED' && r.tournamentStatus === 'PUBLISHED' && r.checkInWindow) {
    const opens = new Date(r.checkInWindow.opensAt);
    if (opens > new Date())
      return (
        <span className="text-sm text-muted">
          Check-in opens {formatDateTime(r.checkInWindow.opensAt)}
        </span>
      );
    return (
      <span className="flex flex-col items-end gap-1">
        <Button variant="ghost" busy={checkIn.isPending} onClick={() => checkIn.mutate()}>
          Check in
        </Button>
        {checkIn.error && <span className="text-sm text-loss">{checkIn.error.message}</span>}
      </span>
    );
  }
  if (r.status === 'VALIDATION_FAILED') {
    return (
      <Link
        href={`/me/teams/${r.teamId}?fix=${r.id}`}
        className="font-semibold text-cobalt hover:underline"
      >
        Fix roster
      </Link>
    );
  }
  return null;
}

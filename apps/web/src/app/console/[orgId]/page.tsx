'use client';

import type { TournamentDto } from '@arenacore/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { EmptyState, ErrorNote, Loading } from '@/components/ui/feedback';
import { DataTable, PageHeader, Td } from '@/components/ui/layout';
import { StatusPill } from '@/components/ui/status';
import { formatDateTime, humanize } from '@/lib/format';
import { useApi } from '@/lib/hooks';

export default function TournamentsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const list = useApi<TournamentDto[]>(`/orgs/${orgId}/tournaments`);
  const newLink = (
    <Link
      href={`/console/${orgId}/tournaments/new`}
      className="inline-flex h-10 items-center rounded-md bg-cobalt px-4 font-semibold text-white hover:bg-cobalt-ink"
    >
      New tournament
    </Link>
  );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Tournaments" actions={newLink} />
      {list.isPending ? (
        <Loading />
      ) : list.error ? (
        <ErrorNote error={list.error} />
      ) : list.data.length === 0 ? (
        <EmptyState title="No tournaments yet" action={newLink}>
          Create a draft, set the format and schedule, then publish it when registration should
          open.
        </EmptyState>
      ) : (
        <DataTable head={['Tournament', 'Status', 'Format', 'Teams', 'Starts']}>
          {list.data.map((t) => {
            const entered =
              (t.registrationCounts.APPROVED ?? 0) + (t.registrationCounts.CHECKED_IN ?? 0);
            const waiting =
              (t.registrationCounts.SUBMITTED ?? 0) + (t.registrationCounts.UNDER_REVIEW ?? 0);
            return (
              <tr key={t.id} className="hover:bg-paper">
                <Td>
                  <Link
                    href={`/console/${orgId}/tournaments/${t.id}`}
                    className="font-semibold text-ink hover:text-cobalt"
                  >
                    {t.name}
                  </Link>
                  <div className="text-sm text-muted">
                    {t.gameName}, {t.region}
                  </div>
                </Td>
                <Td>
                  <StatusPill status={t.status} />
                </Td>
                <Td className="text-muted">{humanize(t.format)}</Td>
                <Td>
                  {entered}/{t.maxTeams}
                  {waiting > 0 && (
                    <span className="ml-2 text-sm font-semibold text-cobalt">
                      {waiting} to review
                    </span>
                  )}
                </Td>
                <Td className="text-muted">{formatDateTime(t.startsAt)}</Td>
              </tr>
            );
          })}
        </DataTable>
      )}
    </div>
  );
}

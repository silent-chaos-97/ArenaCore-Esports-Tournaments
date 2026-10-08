'use client';

import type { DisputeDto } from '@arenacore/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { EmptyState, ErrorNote, Loading } from '@/components/ui/feedback';
import { Checkbox } from '@/components/ui/field';
import { DataTable, PageHeader, Td } from '@/components/ui/layout';
import { StatusPill } from '@/components/ui/status';
import { formatRelative, humanize } from '@/lib/format';
import { useApi } from '@/lib/hooks';

const VIEWS = [
  { key: 'open', label: 'Open', statuses: ['OPEN', 'ASSIGNED', 'INVESTIGATING'] },
  { key: 'resolved', label: 'Resolved', statuses: ['RESOLVED', 'WITHDRAWN'] },
] as const;

export default function DisputesPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [mine, setMine] = useState(false);
  const [view, setView] = useState<(typeof VIEWS)[number]['key']>('open');
  const disputes = useApi<DisputeDto[]>(
    `/orgs/${orgId}/disputes${mine ? '?assignedToMe=true' : ''}`,
    { refetchInterval: 20_000 },
  );
  const statuses = VIEWS.find((v) => v.key === view)!.statuses as readonly string[];
  const rows = disputes.data?.filter((d) => statuses.includes(d.status)) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Disputes" />
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex gap-2" role="tablist">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              role="tab"
              aria-selected={view === v.key}
              onClick={() => setView(v.key)}
              className={`rounded-full border px-3 py-1 text-[15px] font-semibold ${view === v.key ? 'border-cobalt bg-cobalt-wash text-cobalt-ink' : 'border-rule text-muted hover:text-ink'}`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <Checkbox
          label="Assigned to me"
          checked={mine}
          onChange={(e) => setMine(e.target.checked)}
        />
      </div>
      {disputes.isPending ? (
        <Loading />
      ) : disputes.error ? (
        <ErrorNote error={disputes.error} />
      ) : rows.length === 0 ? (
        <EmptyState title={view === 'open' ? 'No open disputes' : 'No resolved disputes yet'}>
          Disputes open when captains challenge a result or their score reports don’t match.
        </EmptyState>
      ) : (
        <DataTable head={['Dispute', 'Tournament', 'Status', 'Referee', 'Opened']}>
          {rows.map((d) => (
            <tr key={d.id} className="hover:bg-paper">
              <Td>
                <Link
                  href={`/console/${orgId}/disputes/${d.id}`}
                  className="font-semibold text-ink hover:text-cobalt"
                >
                  {humanize(d.reason)}
                </Link>
                <div className="text-sm text-muted">Match {d.matchKey}</div>
              </Td>
              <Td className="text-muted">{d.tournamentName}</Td>
              <Td>
                <StatusPill status={d.status} />
              </Td>
              <Td className="text-muted">{d.assignedToName ?? 'Unassigned'}</Td>
              <Td className="text-muted">{formatRelative(d.createdAt)}</Td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}

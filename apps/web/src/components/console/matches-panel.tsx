'use client';

import type { MatchSummaryDto } from '@arenacore/shared';
import { useState } from 'react';
import { EmptyState, ErrorNote, Loading } from '@/components/ui/feedback';
import { DataTable, Td } from '@/components/ui/layout';
import { StatusPill } from '@/components/ui/status';
import { formatDateTime } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { MatchDialog } from './match-dialog';

const VIEWS = [
  {
    key: 'attention',
    label: 'Needs attention',
    statuses: ['DISPUTED', 'NO_SHOW_REVIEW', 'CHECK_IN_EXPIRED', 'RESULT_PENDING'],
  },
  { key: 'live', label: 'Live', statuses: ['READY', 'IN_PROGRESS', 'CHECK_IN_OPEN'] },
  { key: 'upcoming', label: 'Upcoming', statuses: ['SCHEDULED', 'PENDING'] },
  { key: 'done', label: 'Finished', statuses: ['COMPLETED', 'FORFEITED'] },
] as const;

/** Admin match dashboard: what needs a decision first, then what's live and next. */
export function MatchesPanel({ orgId, tournamentId }: { orgId: string; tournamentId: string }) {
  const matches = useApi<MatchSummaryDto[]>(`/orgs/${orgId}/tournaments/${tournamentId}/matches`, {
    key: ['matches', tournamentId],
    refetchInterval: 15_000,
  });
  const [view, setView] = useState<(typeof VIEWS)[number]['key']>('attention');
  const [selected, setSelected] = useState<MatchSummaryDto | null>(null);
  if (matches.isPending) return <Loading />;
  if (matches.error) return <ErrorNote error={matches.error} />;
  const statuses = VIEWS.find((v) => v.key === view)!.statuses as readonly string[];
  const rows = matches.data.filter((m) => statuses.includes(m.status));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2" role="tablist">
        {VIEWS.map((v) => {
          const count = matches.data.filter((m) =>
            (v.statuses as readonly string[]).includes(m.status),
          ).length;
          return (
            <button
              key={v.key}
              role="tab"
              aria-selected={view === v.key}
              onClick={() => setView(v.key)}
              className={`rounded-full border px-3 py-1 text-[15px] font-semibold ${view === v.key ? 'border-cobalt bg-cobalt-wash text-cobalt-ink' : 'border-rule text-muted hover:text-ink'} ${v.key === 'attention' && count > 0 && view !== v.key ? 'text-loss' : ''}`}
            >
              {v.label} <span className="font-display">{count}</span>
            </button>
          );
        })}
      </div>
      {rows.length === 0 ? (
        <EmptyState
          title={view === 'attention' ? 'Nothing needs you right now' : 'No matches in this view'}
        />
      ) : (
        <DataTable head={['Match', 'Teams', 'Status', 'Scheduled', 'Score']}>
          {rows.map((m) => (
            <tr key={m.id} className="cursor-pointer hover:bg-paper" onClick={() => setSelected(m)}>
              <Td>
                <button
                  className="font-semibold text-ink hover:text-cobalt"
                  onClick={() => setSelected(m)}
                >
                  {m.roundName}
                </button>
                <div className="text-sm text-muted">{m.key}</div>
              </Td>
              <Td>
                {m.a?.teamName ?? 'TBD'} <span className="text-muted">vs</span>{' '}
                {m.b?.teamName ?? 'TBD'}
              </Td>
              <Td>
                <StatusPill status={m.status} />
              </Td>
              <Td className="text-muted">{formatDateTime(m.scheduledAt)}</Td>
              <Td className="font-display text-lg font-bold">
                {m.scoreA !== null ? `${m.scoreA}-${m.scoreB}` : ''}
              </Td>
            </tr>
          ))}
        </DataTable>
      )}
      <MatchDialog orgId={orgId} match={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

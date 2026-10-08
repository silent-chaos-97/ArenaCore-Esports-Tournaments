'use client';

import type { AuditEntryDto, Page } from '@arenacore/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorNote, Loading } from '@/components/ui/feedback';
import { DataTable, PageHeader, Td } from '@/components/ui/layout';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

/** Who changed what, when, and why: every administrative action in this organization. */
export default function AuditPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const audit = useInfiniteQuery({
    queryKey: ['audit', orgId],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      api<Page<AuditEntryDto>>(
        `/orgs/${orgId}/audit?limit=50${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = audit.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Audit log" />
      {audit.isPending ? (
        <Loading />
      ) : audit.error ? (
        <ErrorNote error={audit.error} />
      ) : rows.length === 0 ? (
        <EmptyState title="No administrative actions yet" />
      ) : (
        <>
          <DataTable head={['When', 'Who', 'Action', 'Change', 'Reason']}>
            {rows.map((r) => (
              <tr key={r.id} className="align-top">
                <Td className="whitespace-nowrap text-muted">{formatDateTime(r.createdAt)}</Td>
                <Td>{r.actorName ?? 'System'}</Td>
                <Td>
                  <span className="font-semibold">
                    {r.action.replace('.', ': ').replaceAll('_', ' ')}
                  </span>
                  <div className="text-sm text-muted">
                    {r.entity} {r.entityId.slice(0, 8)}
                  </div>
                </Td>
                <Td className="max-w-md text-sm">
                  <ChangeSummary before={r.oldValue} after={r.newValue} />
                </Td>
                <Td className="text-sm">{r.reason ?? ''}</Td>
              </tr>
            ))}
          </DataTable>
          {audit.hasNextPage && (
            <div>
              <Button
                variant="secondary"
                busy={audit.isFetchingNextPage}
                onClick={() => void audit.fetchNextPage()}
              >
                Load older entries
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ChangeSummary({ before, after }: { before: unknown; after: unknown }) {
  const flat = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
  const keys = [...new Set([...Object.keys(flat(before)), ...Object.keys(flat(after))])].slice(
    0,
    6,
  );
  if (keys.length === 0) return <span className="text-muted">—</span>;
  const show = (v: unknown) =>
    v === undefined || v === null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return (
    <ul className="flex flex-col gap-0.5">
      {keys.map((k) => (
        <li key={k} className="break-words">
          <span className="text-muted">{k}</span>{' '}
          {k in flat(before) && (
            <span className="line-through decoration-muted">{show(flat(before)[k])}</span>
          )}{' '}
          {k in flat(after) && <span className="font-semibold">{show(flat(after)[k])}</span>}
        </li>
      ))}
    </ul>
  );
}

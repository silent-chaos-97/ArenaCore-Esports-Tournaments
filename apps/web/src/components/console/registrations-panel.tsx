'use client';

import type { RegistrationDto, TournamentDto } from '@arenacore/shared';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState, ErrorNote, Loading } from '@/components/ui/feedback';
import { Field, TextInput } from '@/components/ui/field';
import { DataTable, Section, Td } from '@/components/ui/layout';
import { StatusPill } from '@/components/ui/status';
import { useAction, useApi } from '@/lib/hooks';

const FILTERS = [
  { key: 'review', label: 'To review', statuses: ['SUBMITTED', 'UNDER_REVIEW'] },
  { key: 'entered', label: 'Accepted', statuses: ['APPROVED', 'CHECKED_IN'] },
  { key: 'problems', label: 'Needs changes', statuses: ['VALIDATION_FAILED'] },
  { key: 'closed', label: 'Rejected or withdrawn', statuses: ['REJECTED', 'WITHDRAWN'] },
] as const;

export function RegistrationsPanel({
  orgId,
  tournament,
}: {
  orgId: string;
  tournament: TournamentDto;
}) {
  const base = `/orgs/${orgId}/tournaments/${tournament.id}`;
  const key = ['registrations', tournament.id];
  const regs = useApi<RegistrationDto[]>(`${base}/registrations`, { key });
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('review');
  const [rejecting, setRejecting] = useState<RegistrationDto | null>(null);
  const invalidate = [key, [`${base}`]];

  const act = useAction(
    (input: { id: string; action: 'review' | 'approve' | 'check-in' }) => ({
      path: `${base}/registrations/${input.id}/${input.action}`,
      method: 'POST',
    }),
    {
      success: 'Registration updated',
      invalidate,
    },
  );

  if (regs.isPending) return <Loading />;
  if (regs.error) return <ErrorNote error={regs.error} />;
  const visible = regs.data.filter((r) =>
    (FILTERS.find((f) => f.key === filter)!.statuses as readonly string[]).includes(r.status),
  );
  const editable = tournament.status === 'PUBLISHED';

  return (
    <div className="flex flex-col gap-8">
      <Section title="Registrations">
        <div className="flex flex-wrap gap-2" role="tablist">
          {FILTERS.map((f) => {
            const count = regs.data.filter((r) =>
              (f.statuses as readonly string[]).includes(r.status),
            ).length;
            return (
              <button
                key={f.key}
                role="tab"
                aria-selected={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-full border px-3 py-1 text-[15px] font-semibold ${filter === f.key ? 'border-cobalt bg-cobalt-wash text-cobalt-ink' : 'border-rule text-muted hover:text-ink'}`}
              >
                {f.label} <span className="font-display">{count}</span>
              </button>
            );
          })}
        </div>
        <ErrorNote error={act.error} />
        {visible.length === 0 ? (
          <EmptyState title="Nothing here">
            Registrations appear as captains submit their rosters.
          </EmptyState>
        ) : (
          <DataTable head={['Team', 'Roster', 'Status', '']}>
            {visible.map((r) => (
              <tr key={r.id}>
                <Td>
                  <span className="font-semibold">{r.teamName}</span>
                  {r.seed && <span className="ml-2 text-sm text-muted">Seed {r.seed}</span>}
                </Td>
                <Td className="text-sm">
                  {r.members.length > 0
                    ? r.members
                        .map(
                          (m) =>
                            `${m.displayName}${m.role === 'SUBSTITUTE' ? ' (sub)' : m.role === 'CAPTAIN' ? ' (c)' : ''}`,
                        )
                        .join(', ')
                    : r.validationErrors.map((e) => e.message).join('; ') ||
                      r.rejectionReason ||
                      '—'}
                </Td>
                <Td>
                  <StatusPill status={r.status} />
                </Td>
                <Td className="text-right whitespace-nowrap">
                  {editable && r.status === 'SUBMITTED' && (
                    <Button
                      variant="ghost"
                      onClick={() => act.mutate({ id: r.id, action: 'review' })}
                    >
                      Start review
                    </Button>
                  )}
                  {editable && (r.status === 'SUBMITTED' || r.status === 'UNDER_REVIEW') && (
                    <>
                      <Button
                        variant="ghost"
                        onClick={() => act.mutate({ id: r.id, action: 'approve' })}
                      >
                        Approve
                      </Button>
                      <Button variant="ghost" onClick={() => setRejecting(r)}>
                        Reject
                      </Button>
                    </>
                  )}
                  {editable && r.status === 'APPROVED' && tournament.checkInOpensAt && (
                    <Button
                      variant="ghost"
                      onClick={() => act.mutate({ id: r.id, action: 'check-in' })}
                    >
                      Check in
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>
      {editable && (
        <SeedingEditor
          // Re-mount when seeds or eligibility change on the server so the local order resets.
          key={regs.data.map((r) => `${r.id}:${r.status}:${r.seed}`).join()}
          orgId={orgId}
          tournament={tournament}
          registrations={regs.data}
        />
      )}
      <RejectDialog
        orgId={orgId}
        tournamentId={tournament.id}
        registration={rejecting}
        onClose={() => setRejecting(null)}
      />
    </div>
  );
}

function RejectDialog({
  orgId,
  tournamentId,
  registration,
  onClose,
}: {
  orgId: string;
  tournamentId: string;
  registration: RegistrationDto | null;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const reject = useAction(
    () => ({
      path: `/orgs/${orgId}/tournaments/${tournamentId}/registrations/${registration!.id}/reject`,
      method: 'POST',
      body: { reason },
    }),
    {
      success: 'Registration rejected',
      invalidate: [['registrations', tournamentId]],
      onSuccess: onClose,
    },
  );
  return (
    <Dialog
      open={!!registration}
      onClose={onClose}
      title={`Reject ${registration?.teamName ?? ''}`}
    >
      <div className="flex flex-col gap-4">
        <Field label="Reason" hint="The captain sees this message.">
          {(p) => <TextInput {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <ErrorNote error={reject.error} />
        <Button
          variant="danger"
          busy={reject.isPending}
          disabled={reason.length < 3}
          onClick={() => reject.mutate()}
        >
          Reject registration
        </Button>
      </div>
    </Dialog>
  );
}

/** Drag-free seeding: move teams up and down, or shuffle reproducibly. */
function SeedingEditor({
  orgId,
  tournament,
  registrations,
}: {
  orgId: string;
  tournament: TournamentDto;
  registrations: RegistrationDto[];
}) {
  const usesCheckIn = tournament.checkInOpensAt !== null;
  const eligible = registrations
    .filter((r) =>
      usesCheckIn
        ? r.status === 'CHECKED_IN'
        : r.status === 'APPROVED' || r.status === 'CHECKED_IN',
    )
    .sort((a, b) => (a.seed ?? 999) - (b.seed ?? 999));
  const [order, setOrder] = useState(eligible.map((r) => r.id));
  const base = `/orgs/${orgId}/tournaments/${tournament.id}`;
  const invalidate = [['registrations', tournament.id]];
  const save = useAction(() => ({ path: `${base}/seeding`, method: 'PUT', body: { order } }), {
    success: 'Seeding saved',
    invalidate,
  });
  const shuffle = useAction(
    () => ({ path: `${base}/seeding/randomize`, method: 'POST', body: {} }),
    { success: 'Seeds shuffled', invalidate },
  );
  const byId = new Map(registrations.map((r) => [r.id, r]));
  const move = (index: number, delta: number) =>
    setOrder((o) => {
      const next = [...o];
      const [item] = next.splice(index, 1);
      next.splice(index + delta, 0, item!);
      return next;
    });

  return (
    <Section
      title="Seeding"
      actions={
        <div className="flex gap-2">
          <Button
            variant="secondary"
            busy={shuffle.isPending}
            disabled={order.length < 2}
            onClick={() => shuffle.mutate()}
          >
            Shuffle seeds
          </Button>
          <Button busy={save.isPending} disabled={order.length < 2} onClick={() => save.mutate()}>
            Save seeding
          </Button>
        </div>
      }
    >
      <p className="text-[15px] text-muted">
        {usesCheckIn ? 'Only checked-in teams are seeded.' : 'All accepted teams are seeded.'} Seed
        1 meets the lowest seed first, and the top seeds receive any byes.
      </p>
      <ErrorNote error={save.error ?? shuffle.error} />
      {order.length === 0 ? (
        <EmptyState title="No teams to seed yet" />
      ) : (
        <ol className="flex flex-col divide-y divide-rule rounded-lg border border-rule bg-surface">
          {order.map((id, i) => (
            <li key={id} className="flex items-center gap-3 px-4 py-2">
              <span className="w-8 font-display text-2xl font-bold text-muted">{i + 1}</span>
              <span className="flex-1 font-semibold">{byId.get(id)?.teamName}</span>
              <button
                className="rounded px-2 py-1 text-muted hover:bg-paper hover:text-ink disabled:opacity-30"
                disabled={i === 0}
                onClick={() => move(i, -1)}
                aria-label={`Move ${byId.get(id)?.teamName} up`}
              >
                ↑
              </button>
              <button
                className="rounded px-2 py-1 text-muted hover:bg-paper hover:text-ink disabled:opacity-30"
                disabled={i === order.length - 1}
                onClick={() => move(i, 1)}
                aria-label={`Move ${byId.get(id)?.teamName} down`}
              >
                ↓
              </button>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

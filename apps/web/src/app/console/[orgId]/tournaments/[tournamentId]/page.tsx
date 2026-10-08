'use client';

import type { BracketDto, MatchSummaryDto, TournamentDto } from '@arenacore/shared';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Bracket } from '@/components/bracket';
import { MatchDialog } from '@/components/console/match-dialog';
import { MatchesPanel } from '@/components/console/matches-panel';
import { RegistrationsPanel } from '@/components/console/registrations-panel';
import { TournamentStaffPanel } from '@/components/console/staff-panel';
import {
  FORM_SECTIONS,
  formFromTournament,
  toPayload,
  TournamentFields,
  type TournamentForm,
} from '@/components/console/tournament-fields';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState, ErrorNote, Loading } from '@/components/ui/feedback';
import { Field, TextInput } from '@/components/ui/field';
import { PageHeader, Section } from '@/components/ui/layout';
import { StatusPill } from '@/components/ui/status';
import { ApiError } from '@/lib/api';
import { formatDateTime, humanize } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';

const TABS = ['overview', 'registrations', 'matches', 'bracket', 'staff'] as const;
type Tab = (typeof TABS)[number];

function TournamentWorkspace() {
  const { orgId, tournamentId } = useParams<{ orgId: string; tournamentId: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const tab = (TABS as readonly string[]).includes(params.get('tab') ?? '')
    ? (params.get('tab') as Tab)
    : 'overview';
  const path = `/orgs/${orgId}/tournaments/${tournamentId}`;
  const tournament = useApi<TournamentDto>(path);

  if (tournament.isPending) return <Loading />;
  if (tournament.error) return <ErrorNote error={tournament.error} />;
  const t = tournament.data;
  const started = t.status === 'IN_PROGRESS' || t.status === 'COMPLETED';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.name}
        meta={
          <>
            <StatusPill status={t.status} />
            <span>
              {t.gameName}, {t.region}
            </span>
            <span>{humanize(t.format)}</span>
            <span>Starts {formatDateTime(t.startsAt)}</span>
            {t.status !== 'DRAFT' && (
              <Link href={`/t/${t.slug}`} className="font-semibold text-cobalt hover:underline">
                Public page
              </Link>
            )}
          </>
        }
        actions={<LifecycleActions orgId={orgId} tournament={t} />}
      />
      <nav
        className="flex gap-1 overflow-x-auto border-b border-rule"
        aria-label="Tournament sections"
      >
        {TABS.filter((x) => started || (x !== 'matches' && x !== 'bracket')).map((x) => (
          <button
            key={x}
            onClick={() => router.replace(`?tab=${x}`, { scroll: false })}
            aria-current={tab === x ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-[15px] font-semibold whitespace-nowrap ${tab === x ? 'border-cobalt text-ink' : 'border-transparent text-muted hover:text-ink'}`}
          >
            {humanize(x)}
          </button>
        ))}
      </nav>
      {tab === 'overview' && <Overview orgId={orgId} tournament={t} />}
      {tab === 'registrations' && <RegistrationsPanel orgId={orgId} tournament={t} />}
      {tab === 'matches' && <MatchesPanel orgId={orgId} tournamentId={t.id} />}
      {tab === 'bracket' && <BracketTab orgId={orgId} tournamentId={t.id} />}
      {tab === 'staff' && <TournamentStaffPanel orgId={orgId} tournamentId={t.id} />}
    </div>
  );
}

function LifecycleActions({ orgId, tournament: t }: { orgId: string; tournament: TournamentDto }) {
  const router = useRouter();
  const path = `/orgs/${orgId}/tournaments/${t.id}`;
  const invalidate = [[path], [`/orgs/${orgId}/tournaments`], ['bracket', t.id], ['matches', t.id]];
  const [confirmStart, setConfirmStart] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const publish = useAction(() => ({ path: `${path}/publish`, method: 'POST' }), {
    success: 'Published',
    invalidate,
  });
  const unpublish = useAction(() => ({ path: `${path}/unpublish`, method: 'POST' }), {
    success: 'Moved back to draft',
    invalidate,
  });
  const start = useAction(() => ({ path: `${path}/start`, method: 'POST' }), {
    success: 'Tournament started',
    invalidate,
    onSuccess: () => {
      setConfirmStart(false);
      router.replace('?tab=bracket');
    },
  });
  const cancel = useAction(() => ({ path: `${path}/cancel`, method: 'POST', body: { reason } }), {
    success: 'Tournament cancelled',
    invalidate,
    onSuccess: () => setCancelling(false),
  });
  const clone = useAction<void, TournamentDto>(
    () => ({ path: `${path}/clone`, method: 'POST', body: {} }),
    {
      success: 'Copy created',
      invalidate,
      onSuccess: (copy) => router.push(`/console/${orgId}/tournaments/${copy.id}`),
    },
  );
  const entered = (t.registrationCounts.APPROVED ?? 0) + (t.registrationCounts.CHECKED_IN ?? 0);
  const eligible = t.checkInOpensAt ? (t.registrationCounts.CHECKED_IN ?? 0) : entered;
  const error = publish.error ?? unpublish.error ?? clone.error;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        {t.status === 'DRAFT' && (
          <Button busy={publish.isPending} onClick={() => publish.mutate()}>
            Publish
          </Button>
        )}
        {t.status === 'PUBLISHED' && (
          <>
            <Button onClick={() => setConfirmStart(true)}>Start tournament</Button>
            <Button
              variant="secondary"
              busy={unpublish.isPending}
              onClick={() => unpublish.mutate()}
            >
              Unpublish
            </Button>
          </>
        )}
        <Button variant="secondary" busy={clone.isPending} onClick={() => clone.mutate()}>
          Duplicate
        </Button>
        {(t.status === 'DRAFT' || t.status === 'PUBLISHED' || t.status === 'IN_PROGRESS') && (
          <Button variant="ghost" onClick={() => setCancelling(true)}>
            Cancel tournament
          </Button>
        )}
      </div>
      {error && (
        <div className="max-w-md">
          <ErrorNote error={error} />
        </div>
      )}
      <Dialog
        open={confirmStart}
        onClose={() => setConfirmStart(false)}
        title="Start the tournament?"
      >
        <div className="flex flex-col gap-4">
          <p className="text-[15px]">
            {eligible} {t.checkInOpensAt ? 'checked-in' : 'accepted'} teams will be placed in the
            bracket. Seeding, rosters and the format lock once it starts.
          </p>
          <ErrorNote error={start.error} />
          <Button busy={start.isPending} disabled={eligible < 2} onClick={() => start.mutate()}>
            Start with {eligible} teams
          </Button>
        </div>
      </Dialog>
      <Dialog open={cancelling} onClose={() => setCancelling(false)} title="Cancel the tournament?">
        <div className="flex flex-col gap-4">
          <p className="text-[15px]">All unfinished matches are cancelled. This can’t be undone.</p>
          <Field label="Reason" hint="Recorded in the audit log.">
            {(p) => <TextInput {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
          <ErrorNote error={cancel.error} />
          <Button
            variant="danger"
            busy={cancel.isPending}
            disabled={reason.length < 3}
            onClick={() => cancel.mutate()}
          >
            Cancel tournament
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function Overview({ orgId, tournament: t }: { orgId: string; tournament: TournamentDto }) {
  const [form, setForm] = useState<TournamentForm>(() => formFromTournament(t));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const path = `/orgs/${orgId}/tournaments/${t.id}`;
  // Only send what the organizer edited: inputs round times to the minute, which must not
  // register as a change to locked fields.
  const changes = () => {
    const before = toPayload(formFromTournament(t)) as Record<string, unknown>;
    const after = toPayload(form) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(after).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k])),
    );
  };
  const save = useAction(
    () => ({ path, method: 'PATCH', body: { ...changes(), version: t.version } }),
    {
      success: 'Changes saved',
      invalidate: [[path]],
      onSuccess: () => setErrors({}),
    },
  );
  const readOnly = t.status === 'COMPLETED' || t.status === 'CANCELLED';
  const counts = Object.entries(t.registrationCounts).filter(([, n]) => n > 0);

  return (
    <div className="flex flex-col gap-8">
      <Section title="Registrations at a glance">
        {counts.length === 0 ? (
          <p className="text-[15px] text-muted">
            {t.status === 'DRAFT'
              ? 'Publish the tournament to open registration.'
              : 'No registrations yet.'}
          </p>
        ) : (
          <dl className="flex flex-wrap gap-x-10 gap-y-3">
            {counts.map(([status, n]) => (
              <div key={status}>
                <dt className="text-sm text-muted">{humanize(status)}</dt>
                <dd className="font-display text-4xl font-bold">{n}</dd>
              </div>
            ))}
          </dl>
        )}
      </Section>
      <Section
        title="Settings"
        actions={
          !readOnly && (
            <Button
              busy={save.isPending}
              onClick={() =>
                save.mutate(undefined, {
                  onError: (err) => setErrors(err instanceof ApiError ? err.fieldErrors : {}),
                })
              }
            >
              Save changes
            </Button>
          )
        }
      >
        {t.lockedFields.length > 0 && !readOnly && (
          <p className="text-[15px] text-muted">
            Some competitive settings are locked because teams have registered or the event is live.
          </p>
        )}
        <ErrorNote error={save.error && Object.keys(errors).length === 0 ? save.error : null} />
        <fieldset disabled={readOnly} className="flex flex-col gap-8">
          {FORM_SECTIONS.map((section) => (
            <div key={section} className="rounded-lg border border-rule bg-surface p-5">
              <TournamentFields
                form={form}
                onChange={setForm}
                section={section}
                errors={errors}
                locked={t.lockedFields}
              />
            </div>
          ))}
        </fieldset>
      </Section>
    </div>
  );
}

function BracketTab({ orgId, tournamentId }: { orgId: string; tournamentId: string }) {
  const bracket = useApi<BracketDto>(`/orgs/${orgId}/tournaments/${tournamentId}/bracket`, {
    key: ['bracket', tournamentId],
    refetchInterval: 10_000,
  });
  const [selected, setSelected] = useState<MatchSummaryDto | null>(null);
  if (bracket.isPending) return <Loading />;
  if (bracket.error) return <ErrorNote error={bracket.error} />;
  if (bracket.data.stages.length === 0)
    return <EmptyState title="The bracket appears once the tournament starts" />;
  return (
    <>
      <p className="text-[15px] text-muted">
        Select a match to enter a result, award a forfeit or reschedule it.
      </p>
      <Bracket bracket={bracket.data} onSelect={setSelected} />
      <MatchDialog orgId={orgId} match={selected} onClose={() => setSelected(null)} />
    </>
  );
}

export default function TournamentPage() {
  return (
    <Suspense fallback={<Loading />}>
      <TournamentWorkspace />
    </Suspense>
  );
}

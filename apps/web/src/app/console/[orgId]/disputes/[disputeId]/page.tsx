'use client';

import type { DisputeDto, MatchEvidenceDto, MatchSummaryDto, MemberDto } from '@arenacore/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ErrorNote, Loading } from '@/components/ui/feedback';
import { Field, Select, TextArea, TextInput } from '@/components/ui/field';
import { PageHeader, Section } from '@/components/ui/layout';
import { StatusPill } from '@/components/ui/status';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime, humanize } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';

interface Workspace {
  dispute: DisputeDto;
  match: MatchSummaryDto & {
    results: {
      id: string;
      source: string;
      reportedBySlot: 'A' | 'B' | null;
      scoreA: number;
      scoreB: number;
      status: string;
      note: string | null;
      createdAt: string;
    }[];
    evidence: MatchEvidenceDto[];
    externalMatchId: string | null;
  };
}

const OUTCOMES = [
  { value: 'UPHOLD_RESULT', label: 'Uphold the recorded result' },
  { value: 'OVERTURN_RESULT', label: 'Overturn: set the corrected score' },
  { value: 'FORFEIT', label: 'Award the match by forfeit' },
  { value: 'REPLAY', label: 'Replay the match' },
  { value: 'DISMISSED', label: 'Dismiss the dispute' },
] as const;

/** Referee workspace: every report, result and piece of evidence in one place, then a ruling. */
export default function DisputeWorkspacePage() {
  const { orgId, disputeId } = useParams<{ orgId: string; disputeId: string }>();
  const { user } = useAuth();
  const path = `/orgs/${orgId}/disputes/${disputeId}`;
  const ws = useApi<Workspace>(path);
  const members = useApi<MemberDto[]>(`/orgs/${orgId}/members`);
  const membership = user?.memberships.find((m) => m.organizationId === orgId);
  const isAdmin = membership?.role === 'OWNER' || membership?.role === 'ADMIN';
  const invalidate = [[path], [`/orgs/${orgId}/disputes`]];

  const [assignee, setAssignee] = useState('');
  const assign = useAction(
    (refereeUserId?: string) => ({
      path: `${path}/assign`,
      method: 'POST',
      body: refereeUserId ? { refereeUserId } : {},
    }),
    {
      success: 'Dispute assigned',
      invalidate,
    },
  );
  const investigate = useAction(() => ({ path: `${path}/investigate`, method: 'POST' }), {
    success: 'Investigation started',
    invalidate,
  });

  if (ws.isPending) return <Loading />;
  if (ws.error) return <ErrorNote error={ws.error} />;
  const { dispute: d, match: m } = ws.data;
  const open = ['OPEN', 'ASSIGNED', 'INVESTIGATING'].includes(d.status);
  const canRule = open && (isAdmin || d.assignedToId === user?.id);
  const teamName = (slot: 'A' | 'B' | null) =>
    (slot === 'A' ? m.a?.teamName : slot === 'B' ? m.b?.teamName : null) ?? 'System';

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={humanize(d.reason)}
        meta={
          <>
            <StatusPill status={d.status} />
            <span>{d.tournamentName}</span>
            <span>
              {m.roundName} ({m.key})
            </span>
            <span>
              Opened by {d.openedBySlot ? teamName(d.openedBySlot) : 'conflicting score reports'}
            </span>
          </>
        }
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-8">
          <Section title="What was reported">
            <p className="max-w-prose text-[15px] leading-relaxed whitespace-pre-line">
              {d.description}
            </p>
          </Section>

          <Section title="Match">
            <div className="rounded-lg border border-rule bg-surface p-4">
              <p className="font-display text-2xl font-bold">
                {m.a?.teamName ?? 'TBD'} <span className="text-muted">vs</span>{' '}
                {m.b?.teamName ?? 'TBD'}
              </p>
              <p className="mt-1 text-sm text-muted">
                Best of {m.bestOf}. <StatusPill status={m.status} />
                {m.externalMatchId && <> Game match ID {m.externalMatchId}.</>}
              </p>
              <ul className="mt-3 flex flex-col divide-y divide-rule">
                {m.results.length === 0 && (
                  <li className="py-2 text-sm text-muted">No results reported.</li>
                )}
                {m.results.map((r) => (
                  <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2 text-[15px]">
                    <span>
                      {r.source === 'PARTICIPANT'
                        ? `${teamName(r.reportedBySlot)} reported`
                        : r.source === 'GAME_API'
                          ? 'Game data'
                          : 'Staff entered'}{' '}
                      <span className="font-display text-lg font-bold">
                        {r.scoreA}-{r.scoreB}
                      </span>
                    </span>
                    <span className="text-sm text-muted">
                      {humanize(r.status)}, {formatDateTime(r.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Section>

          <Section title="Evidence">
            <EvidenceList disputeId={d.id} evidence={[...d.evidence, ...m.evidence]} />
          </Section>
        </div>

        <aside className="flex flex-col gap-6">
          <div className="flex flex-col gap-3 rounded-lg border border-rule bg-surface p-4">
            <h2 className="text-xl font-semibold">Referee</h2>
            <p className="text-[15px]">{d.assignedToName ?? 'Nobody is assigned yet.'}</p>
            {open && (
              <div className="flex flex-col gap-2">
                {d.assignedToId !== user?.id && (
                  <Button
                    variant="secondary"
                    busy={assign.isPending}
                    onClick={() => assign.mutate(undefined)}
                  >
                    Assign to me
                  </Button>
                )}
                {isAdmin && (
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <Field label="Assign someone else">
                        {(p) => (
                          <Select
                            {...p}
                            value={assignee}
                            onChange={(e) => setAssignee(e.target.value)}
                          >
                            <option value="">Choose</option>
                            {members.data
                              ?.filter((mm) => mm.role !== 'VIEWER')
                              .map((mm) => (
                                <option key={mm.userId} value={mm.userId}>
                                  {mm.displayName}
                                </option>
                              ))}
                          </Select>
                        )}
                      </Field>
                    </div>
                    <Button
                      variant="secondary"
                      disabled={!assignee}
                      onClick={() => assign.mutate(assignee)}
                    >
                      Assign
                    </Button>
                  </div>
                )}
                {d.status === 'ASSIGNED' && canRule && (
                  <Button
                    variant="ghost"
                    busy={investigate.isPending}
                    onClick={() => investigate.mutate()}
                  >
                    Start investigating
                  </Button>
                )}
              </div>
            )}
            <ErrorNote error={assign.error ?? investigate.error} />
          </div>

          {d.decision ? (
            <div className="flex flex-col gap-2 rounded-lg border border-win/40 bg-win-wash p-4">
              <h2 className="text-xl font-semibold">Ruling</h2>
              <p className="font-semibold">
                {OUTCOMES.find((o) => o.value === d.decision!.outcome)?.label}
              </p>
              <p className="text-[15px] whitespace-pre-line">{d.decision.ruling}</p>
              <p className="text-sm text-muted">{formatDateTime(d.decision.createdAt)}</p>
            </div>
          ) : canRule ? (
            <RulingForm orgId={orgId} dispute={d} match={m} onDone={() => void ws.refetch()} />
          ) : null}
          <Link
            href={`/console/${orgId}/disputes`}
            className="text-[15px] font-semibold text-cobalt hover:underline"
          >
            Back to disputes
          </Link>
        </aside>
      </div>
    </div>
  );
}

function EvidenceList({
  disputeId,
  evidence,
}: {
  disputeId: string;
  evidence: (MatchEvidenceDto & { sizeBytes?: number | null })[];
}) {
  const [error, setError] = useState<unknown>(null);
  async function download(id: string) {
    try {
      const { url } = await api<{ url: string }>(`/disputes/${disputeId}/evidence/${id}/download`);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      setError(err);
    }
  }
  if (evidence.length === 0)
    return <p className="text-[15px] text-muted">No evidence submitted.</p>;
  return (
    <>
      <ul className="flex flex-col divide-y divide-rule rounded-lg border border-rule bg-surface">
        {evidence.map((e) => (
          <li
            key={e.id}
            className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[15px]"
          >
            <div className="min-w-0">
              <p className="font-semibold">{humanize(e.kind)}</p>
              {e.text && <p className="text-muted">{e.text}</p>}
              {e.url && (
                <a
                  href={e.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-cobalt hover:underline"
                >
                  {e.url}
                </a>
              )}
            </div>
            {e.storageKey && (
              <Button variant="ghost" onClick={() => void download(e.id)}>
                Open file
              </Button>
            )}
          </li>
        ))}
      </ul>
      <ErrorNote error={error} />
    </>
  );
}

function RulingForm({
  orgId,
  dispute,
  match,
  onDone,
}: {
  orgId: string;
  dispute: DisputeDto;
  match: Workspace['match'];
  onDone: () => void;
}) {
  // Conflicting reports leave nothing to uphold, so start from setting the correct score.
  const [outcome, setOutcome] = useState<(typeof OUTCOMES)[number]['value']>(
    match.winnerSlot ? 'UPHOLD_RESULT' : 'OVERTURN_RESULT',
  );
  const [winnerSlot, setWinnerSlot] = useState<'A' | 'B'>('A');
  const [scores, setScores] = useState({ a: '', b: '' });
  const [ruling, setRuling] = useState('');
  const resolve = useAction(
    () => ({
      path: `/orgs/${orgId}/disputes/${dispute.id}/resolve`,
      method: 'POST',
      body: {
        outcome,
        ruling,
        ...(outcome === 'FORFEIT' ? { winnerSlot } : {}),
        ...(outcome === 'OVERTURN_RESULT'
          ? { scoreA: Number(scores.a), scoreB: Number(scores.b) }
          : {}),
      },
    }),
    {
      success: 'Ruling recorded',
      idempotent: true,
      invalidate: [[`/orgs/${orgId}/disputes`]],
      onSuccess: onDone,
    },
  );
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-rule bg-surface p-4">
      <h2 className="text-xl font-semibold">Make a ruling</h2>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">Outcome</legend>
        {OUTCOMES.map((o) => (
          <label key={o.value} className="flex items-center gap-2 text-[15px]">
            <input
              type="radio"
              name="outcome"
              value={o.value}
              checked={outcome === o.value}
              onChange={() => setOutcome(o.value)}
              className="accent-[var(--color-cobalt)]"
            />
            {o.label}
          </label>
        ))}
      </fieldset>
      {outcome === 'OVERTURN_RESULT' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={match.a?.teamName ?? 'Side A'}>
            {(p) => (
              <TextInput
                {...p}
                type="number"
                min={0}
                value={scores.a}
                onChange={(e) => setScores((s) => ({ ...s, a: e.target.value }))}
              />
            )}
          </Field>
          <Field label={match.b?.teamName ?? 'Side B'}>
            {(p) => (
              <TextInput
                {...p}
                type="number"
                min={0}
                value={scores.b}
                onChange={(e) => setScores((s) => ({ ...s, b: e.target.value }))}
              />
            )}
          </Field>
        </div>
      )}
      {outcome === 'FORFEIT' && (
        <Field label="Award the win to">
          {(p) => (
            <Select
              {...p}
              value={winnerSlot}
              onChange={(e) => setWinnerSlot(e.target.value as 'A' | 'B')}
            >
              <option value="A">{match.a?.teamName}</option>
              <option value="B">{match.b?.teamName}</option>
            </Select>
          )}
        </Field>
      )}
      <Field
        label="Ruling"
        hint="Both teams see this explanation. It’s also kept in the audit log."
      >
        {(p) => <TextArea {...p} value={ruling} onChange={(e) => setRuling(e.target.value)} />}
      </Field>
      <ErrorNote error={resolve.error} />
      <Button
        busy={resolve.isPending}
        disabled={ruling.trim().length < 10}
        onClick={() => resolve.mutate()}
      >
        Record ruling
      </Button>
    </div>
  );
}

'use client';

import type { MatchSummaryDto } from '@arenacore/shared';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorNote } from '@/components/ui/feedback';
import { Checkbox, Field, TextInput } from '@/components/ui/field';
import { StatusPill } from '@/components/ui/status';
import { formatDateTime, fromLocalInput, toLocalInput } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';

interface MatchDetail extends MatchSummaryDto {
  externalMatchId: string | null;
  serverRegion: string | null;
  results: {
    id: string;
    source: string;
    reportedBySlot: 'A' | 'B' | null;
    scoreA: number;
    scoreB: number;
    status: string;
    note: string | null;
  }[];
  openDisputeId: string | null;
}

/** Referee/admin controls for one match: result entry, forfeits, overrides, rescheduling, lobby. */
export function MatchDialog({
  orgId,
  match,
  onClose,
}: {
  orgId: string;
  match: MatchSummaryDto | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={!!match}
      onClose={onClose}
      title={match ? `${match.roundName} · ${match.key}` : ''}
    >
      {match && <MatchControls orgId={orgId} matchId={match.id} onDone={onClose} />}
    </Dialog>
  );
}

function MatchControls({
  orgId,
  matchId,
  onDone,
}: {
  orgId: string;
  matchId: string;
  onDone: () => void;
}) {
  const detail = useApi<MatchDetail>(`/matches/${matchId}/detail`);
  const m = detail.data;
  const decided = m?.status === 'COMPLETED' || m?.status === 'FORFEITED';
  const [scores, setScores] = useState({ a: '', b: '' });
  const [reason, setReason] = useState('');
  const [override, setOverride] = useState(false);
  const [when, setWhen] = useState('');
  const [lobby, setLobby] = useState<string | null>(null);
  const refresh = [[`/matches/${matchId}/detail`], ['bracket'], ['matches']];

  const result = useAction(
    (forfeitBy?: 'A' | 'B') => ({
      path: `/orgs/${orgId}/matches/${matchId}/result`,
      method: 'POST',
      body: forfeitBy
        ? { forfeitBy, reason, override }
        : { scoreA: Number(scores.a), scoreB: Number(scores.b), reason, override },
    }),
    { success: 'Result saved', invalidate: refresh, idempotent: true, onSuccess: onDone },
  );
  const reschedule = useAction(
    () => ({
      path: `/orgs/${orgId}/matches/${matchId}/schedule`,
      method: 'PATCH',
      body: { scheduledAt: fromLocalInput(when), reason: reason || undefined },
    }),
    {
      success: 'Match rescheduled',
      invalidate: refresh,
    },
  );
  const saveLobby = useAction(
    () => ({
      path: `/orgs/${orgId}/matches/${matchId}/lobby`,
      method: 'PATCH',
      body: { externalMatchId: lobby || null },
    }),
    {
      success: 'Lobby saved',
      invalidate: refresh,
    },
  );
  const createLobby = useAction<void, { externalMatchId: string; joinCode?: string }>(
    () => ({ path: `/orgs/${orgId}/matches/${matchId}/lobby`, method: 'POST' }),
    {
      success: (r) => (r.joinCode ? `Lobby created, join code ${r.joinCode}` : 'Lobby created'),
      invalidate: refresh,
    },
  );

  if (!m) return <p className="text-muted">Loading match…</p>;
  const teamA = m.a?.teamName ?? 'TBD';
  const teamB = m.b?.teamName ?? 'TBD';
  const playable = !!m.a && !!m.b && !m.isBye;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-display text-2xl font-bold">
          {teamA} <span className="text-muted">vs</span> {teamB}
        </p>
        <StatusPill status={m.status} />
      </div>
      <p className="text-sm text-muted">
        Best of {m.bestOf}. Scheduled {formatDateTime(m.scheduledAt)}.
        {m.openDisputeId && (
          <>
            {' '}
            <Link
              href={`/console/${orgId}/disputes/${m.openDisputeId}`}
              className="font-semibold text-loss hover:underline"
            >
              Open dispute
            </Link>
          </>
        )}
      </p>

      {m.results.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {m.results.map((r) => (
            <li key={r.id} className={r.status === 'SUPERSEDED' ? 'text-muted line-through' : ''}>
              {r.source === 'PARTICIPANT'
                ? `${r.reportedBySlot === 'A' ? teamA : teamB} reported`
                : r.source === 'GAME_API'
                  ? 'Game data'
                  : 'Staff'}{' '}
              {r.scoreA}-{r.scoreB} ({r.status.toLowerCase()})
            </li>
          ))}
        </ul>
      )}

      {playable && (
        <section className="flex flex-col gap-3 border-t border-rule pt-4">
          <h3 className="text-xl font-semibold">
            {decided ? 'Correct the result' : 'Enter the result'}
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label={teamA}>
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
            <Field label={teamB}>
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
          <Field label="Reason" hint="Recorded in the audit log.">
            {(p) => (
              <TextInput
                {...p}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Verified from the game client"
              />
            )}
          </Field>
          {decided && (
            <Checkbox
              label="Replace the existing result. Later matches that depended on it are reset."
              checked={override}
              onChange={(e) => setOverride(e.target.checked)}
            />
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              busy={result.isPending}
              disabled={!scores.a || !scores.b || reason.length < 3 || (decided && !override)}
              onClick={() => result.mutate(undefined)}
            >
              Save result
            </Button>
            <Button
              variant="secondary"
              disabled={reason.length < 3 || (decided && !override)}
              onClick={() => result.mutate('B')}
            >
              Forfeit win to {teamA}
            </Button>
            <Button
              variant="secondary"
              disabled={reason.length < 3 || (decided && !override)}
              onClick={() => result.mutate('A')}
            >
              Forfeit win to {teamB}
            </Button>
          </div>
          <ErrorNote error={result.error} />
        </section>
      )}

      {!decided && (
        <section className="flex flex-col gap-3 border-t border-rule pt-4">
          <h3 className="text-xl font-semibold">Reschedule</h3>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1">
              <Field label="New start time">
                {(p) => (
                  <TextInput
                    {...p}
                    type="datetime-local"
                    value={when || toLocalInput(m.scheduledAt)}
                    onChange={(e) => setWhen(e.target.value)}
                  />
                )}
              </Field>
            </div>
            <Button
              variant="secondary"
              busy={reschedule.isPending}
              disabled={!when}
              onClick={() => reschedule.mutate()}
            >
              Reschedule match
            </Button>
          </div>
          <ErrorNote error={reschedule.error} />
        </section>
      )}

      {playable && !decided && (
        <section className="flex flex-col gap-3 border-t border-rule pt-4">
          <h3 className="text-xl font-semibold">Game lobby</h3>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1">
              <Field
                label="Lobby or game match ID"
                hint="Game results sent for this ID are applied automatically."
              >
                {(p) => (
                  <TextInput
                    {...p}
                    value={lobby ?? m.externalMatchId ?? ''}
                    onChange={(e) => setLobby(e.target.value)}
                  />
                )}
              </Field>
            </div>
            <Button
              variant="secondary"
              disabled={lobby === null}
              busy={saveLobby.isPending}
              onClick={() => saveLobby.mutate()}
            >
              Save lobby
            </Button>
            <Button
              variant="ghost"
              busy={createLobby.isPending}
              onClick={() => createLobby.mutate()}
            >
              Generate lobby
            </Button>
          </div>
          <ErrorNote error={saveLobby.error ?? createLobby.error} />
        </section>
      )}
    </div>
  );
}

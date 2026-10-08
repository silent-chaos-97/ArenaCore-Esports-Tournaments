'use client';

import {
  DISPUTE_REASONS,
  type DisputeDto,
  type MatchEvidenceDto,
  type MatchSummaryDto,
  type TeamDto,
} from '@arenacore/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ErrorNote, Loading } from '@/components/ui/feedback';
import { Field, Select, TextArea, TextInput } from '@/components/ui/field';
import { Section } from '@/components/ui/layout';
import { StatusPill } from '@/components/ui/status';
import { api } from '@/lib/api';
import { formatDateTime, humanize } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { useEventStream } from '@/lib/live';

interface Detail extends MatchSummaryDto {
  results: {
    id: string;
    source: string;
    reportedBySlot: 'A' | 'B' | null;
    scoreA: number;
    scoreB: number;
    status: string;
  }[];
  evidence: MatchEvidenceDto[];
  openDisputeId: string | null;
}

/** The match room: check in, report the score, or raise a dispute. */
export default function MatchRoomPage() {
  const { matchId } = useParams<{ matchId: string }>();
  const key = ['me', 'match', matchId];
  const match = useApi<Detail>(`/matches/${matchId}/detail`, { key });
  const teams = useApi<TeamDto[]>('/teams/mine', { key: ['me', 'teams'] });
  const client = useQueryClient();
  useEventStream(
    match.data ? `/tournaments/${match.data.tournamentId}/stream` : null,
    (_type, data) => {
      if ((data as { matchId?: string }).matchId === matchId)
        void client.invalidateQueries({ queryKey: key });
    },
    {
      types: [
        'OpponentCheckedIn',
        'ResultReported',
        'MatchCompleted',
        'MatchRescheduled',
        'DisputeOpened',
        'DisputeResolved',
        'CheckInOpened',
      ],
    },
  );

  if (match.isPending || teams.isPending) return <Loading />;
  if (match.error) return <ErrorNote error={match.error} />;
  const m = match.data;
  const mine = new Set(teams.data?.map((t) => t.id));
  const mySlot: 'A' | 'B' | null =
    m.a && mine.has(m.a.teamId) ? 'A' : m.b && mine.has(m.b.teamId) ? 'B' : null;
  const myReport = m.results.find(
    (r) => r.source === 'PARTICIPANT' && r.reportedBySlot === mySlot && r.status === 'SUBMITTED',
  );
  const theirReport = m.results.find(
    (r) => r.source === 'PARTICIPANT' && r.reportedBySlot !== mySlot && r.status === 'SUBMITTED',
  );

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3 border-b border-rule pb-6">
        <div className="flex flex-wrap items-center gap-3 text-[15px] text-muted">
          <StatusPill status={m.status} />
          <span>
            {m.roundName}, best of {m.bestOf}
          </span>
          <span>{formatDateTime(m.scheduledAt)}</span>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <TeamSide
            name={m.a?.teamName}
            checkedIn={m.a?.checkedIn}
            mine={mySlot === 'A'}
            won={m.winnerSlot === 'A'}
          />
          {m.scoreA !== null && m.scoreB !== null ? (
            <p className="font-display text-6xl font-bold sm:text-7xl">
              {m.scoreA}
              <span className="mx-2 text-muted">:</span>
              {m.scoreB}
            </p>
          ) : (
            <p className="font-display text-4xl font-bold text-muted">vs</p>
          )}
          <TeamSide
            name={m.b?.teamName}
            checkedIn={m.b?.checkedIn}
            mine={mySlot === 'B'}
            won={m.winnerSlot === 'B'}
            alignEnd
          />
        </div>
      </header>

      {mySlot && <CheckIn match={m} mySlot={mySlot} />}
      {mySlot && ['READY', 'IN_PROGRESS', 'RESULT_PENDING'].includes(m.status) && (
        <ReportScore match={m} myReport={myReport} theirReport={theirReport} />
      )}
      {m.status === 'DISPUTED' && (
        <p className="rounded-md border border-loss/30 bg-loss-wash px-4 py-3 text-[15px]">
          This match is under review. A referee will rule on it and both teams will be notified.
        </p>
      )}
      {mySlot && <Dispute match={m} />}

      {m.results.length > 0 && (
        <Section title="Score reports">
          <ul className="flex flex-col gap-1 text-[15px]">
            {m.results.map((r) => (
              <li key={r.id} className={r.status === 'SUPERSEDED' ? 'text-muted line-through' : ''}>
                {r.source === 'PARTICIPANT'
                  ? `${(r.reportedBySlot === 'A' ? m.a : m.b)?.teamName} reported`
                  : r.source === 'GAME_API'
                    ? 'Game data'
                    : 'Referee set'}{' '}
                <span className="font-display text-lg font-bold">
                  {r.scoreA}:{r.scoreB}
                </span>{' '}
                <span className="text-muted">({humanize(r.status).toLowerCase()})</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function TeamSide({
  name,
  checkedIn,
  mine,
  won,
  alignEnd,
}: {
  name?: string;
  checkedIn?: boolean;
  mine: boolean;
  won: boolean;
  alignEnd?: boolean;
}) {
  return (
    <div className={`min-w-0 ${alignEnd ? 'text-right' : ''}`}>
      <p
        className={`truncate font-display text-3xl font-bold sm:text-4xl ${won ? 'text-win' : ''}`}
      >
        {name ?? 'TBD'}
      </p>
      <p className="text-sm text-muted">
        {mine ? 'Your team' : 'Opponent'}
        {checkedIn ? ', checked in' : ''}
      </p>
    </div>
  );
}

function CheckIn({ match, mySlot }: { match: Detail; mySlot: 'A' | 'B' }) {
  const meCheckedIn = (mySlot === 'A' ? match.a : match.b)?.checkedIn;
  const checkIn = useAction(() => ({ path: `/matches/${match.id}/check-in`, method: 'POST' }), {
    success: 'Checked in',
    idempotent: true,
    invalidate: [['me']],
  });
  if (!['SCHEDULED', 'CHECK_IN_OPEN'].includes(match.status) || meCheckedIn) return null;
  const opens = match.checkInOpensAt ? new Date(match.checkInOpensAt) : null;
  return (
    <Section title="Check in">
      <p className="text-[15px] text-muted">
        {opens && opens > new Date()
          ? `Check-in opens ${formatDateTime(match.checkInOpensAt)}.`
          : `Check in before ${formatDateTime(match.checkInDeadline)} or your team may forfeit.`}
      </p>
      <ErrorNote error={checkIn.error} />
      <div>
        <Button busy={checkIn.isPending} onClick={() => checkIn.mutate()}>
          Check in for this match
        </Button>
      </div>
    </Section>
  );
}

function ReportScore({
  match,
  myReport,
  theirReport,
}: {
  match: Detail;
  myReport?: Detail['results'][number];
  theirReport?: Detail['results'][number];
}) {
  const [scores, setScores] = useState({ a: '', b: '' });
  const [proof, setProof] = useState('');
  const report = useAction(
    (input: { a: number; b: number }) => ({
      path: `/matches/${match.id}/results`,
      method: 'POST',
      body: {
        scoreA: input.a,
        scoreB: input.b,
        evidence: proof ? [{ kind: 'SCREENSHOT', url: proof }] : undefined,
      },
    }),
    { success: 'Score reported', idempotent: true, invalidate: [['me']] },
  );

  return (
    <Section title="Report the score">
      {theirReport && !myReport && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber/60 bg-amber-wash px-4 py-3">
          <p className="text-[15px]">
            Your opponent reported{' '}
            <span className="font-display text-xl font-bold">
              {match.a?.teamName} {theirReport.scoreA} : {theirReport.scoreB} {match.b?.teamName}
            </span>
            .
          </p>
          <Button
            busy={report.isPending}
            onClick={() => report.mutate({ a: theirReport.scoreA, b: theirReport.scoreB })}
          >
            Confirm this score
          </Button>
        </div>
      )}
      {myReport && (
        <p className="text-[15px] text-muted">
          You reported {myReport.scoreA} : {myReport.scoreB}. Waiting for your opponent to confirm.
        </p>
      )}
      <div className="grid max-w-xl gap-3 sm:grid-cols-2">
        <Field label={`${match.a?.teamName ?? 'Side A'} wins`}>
          {(p) => (
            <TextInput
              {...p}
              type="number"
              min={0}
              max={match.bestOf}
              value={scores.a}
              onChange={(e) => setScores((s) => ({ ...s, a: e.target.value }))}
            />
          )}
        </Field>
        <Field label={`${match.b?.teamName ?? 'Side B'} wins`}>
          {(p) => (
            <TextInput
              {...p}
              type="number"
              min={0}
              max={match.bestOf}
              value={scores.b}
              onChange={(e) => setScores((s) => ({ ...s, b: e.target.value }))}
            />
          )}
        </Field>
        <div className="sm:col-span-2">
          <Field label="Scoreboard screenshot link (optional)">
            {(p) => (
              <TextInput
                {...p}
                type="url"
                value={proof}
                onChange={(e) => setProof(e.target.value)}
              />
            )}
          </Field>
        </div>
      </div>
      <ErrorNote error={report.error} />
      <div>
        <Button
          variant={theirReport && !myReport ? 'secondary' : 'primary'}
          busy={report.isPending}
          disabled={scores.a === '' || scores.b === ''}
          onClick={() => report.mutate({ a: Number(scores.a), b: Number(scores.b) })}
        >
          {myReport
            ? 'Change my report'
            : theirReport
              ? 'Report a different score'
              : 'Report score'}
        </Button>
      </div>
      <p className="text-sm text-muted">
        If both teams report the same score, the result is confirmed and the winner advances.
        Different scores go to a referee.
      </p>
    </Section>
  );
}

function Dispute({ match }: { match: Detail }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof DISPUTE_REASONS)[number]>('INCORRECT_RESULT');
  const [description, setDescription] = useState('');
  const [disputeId, setDisputeId] = useState<string | null>(match.openDisputeId);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<unknown>(null);
  const create = useAction<void, DisputeDto>(
    () => ({
      path: `/matches/${match.id}/disputes`,
      method: 'POST',
      body: { reason, description },
    }),
    {
      success: 'Dispute opened',
      idempotent: true,
      invalidate: [['me']],
      onSuccess: (d) => setDisputeId(d.id),
    },
  );

  async function upload(file: File) {
    if (!disputeId) return;
    setUploading(true);
    setUploadError(null);
    try {
      const slot = await api<{ uploadUrl: string; storageKey: string }>(
        `/disputes/${disputeId}/evidence/upload-url`,
        {
          method: 'POST',
          body: { kind: 'SCREENSHOT', contentType: file.type, sizeBytes: file.size },
        },
      );
      const put = await fetch(slot.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'content-type': file.type },
      });
      if (!put.ok) throw new Error('The upload failed. Try again.');
      await api(`/disputes/${disputeId}/evidence`, {
        method: 'POST',
        body: { kind: 'SCREENSHOT', storageKey: slot.storageKey },
      });
      await client.invalidateQueries({ queryKey: ['me'] });
    } catch (err) {
      setUploadError(err);
    } finally {
      setUploading(false);
    }
  }

  const disputable =
    !match.isBye &&
    [
      'READY',
      'IN_PROGRESS',
      'RESULT_PENDING',
      'NO_SHOW_REVIEW',
      'COMPLETED',
      'FORFEITED',
      'CHECK_IN_OPEN',
      'SCHEDULED',
      'DISPUTED',
    ].includes(match.status);
  if (!disputable) return null;

  if (disputeId) {
    return (
      <Section title="Evidence for the referee">
        <p className="text-[15px] text-muted">
          Add scoreboard screenshots (PNG, JPEG or WebP, up to 25 MB). Referees see everything both
          teams submit.
        </p>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={uploading}
          onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])}
          className="text-[15px] file:mr-3 file:rounded-md file:border file:border-rule file:bg-surface file:px-3 file:py-2 file:font-semibold"
        />
        {uploading && <p className="text-sm text-muted">Uploading…</p>}
        <ErrorNote error={uploadError} />
        {match.evidence.length > 0 && (
          <p className="text-sm text-muted">
            {match.evidence.length} item(s) attached to the match.
          </p>
        )}
      </Section>
    );
  }

  return (
    <Section title="Something wrong?">
      {!open ? (
        <div>
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Open a dispute
          </Button>
        </div>
      ) : (
        <div className="flex max-w-xl flex-col gap-4">
          <Field label="What happened">
            {(p) => (
              <Select
                {...p}
                value={reason}
                onChange={(e) => setReason(e.target.value as typeof reason)}
              >
                {DISPUTE_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {humanize(r)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label="Details"
            hint="Say what happened and what you think the correct outcome is. You can add screenshots next."
          >
            {(p) => (
              <TextArea
                {...p}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            )}
          </Field>
          <ErrorNote error={create.error} />
          <div className="flex gap-2">
            <Button
              busy={create.isPending}
              disabled={description.trim().length < 10}
              onClick={() => create.mutate()}
            >
              Open dispute
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Never mind
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}

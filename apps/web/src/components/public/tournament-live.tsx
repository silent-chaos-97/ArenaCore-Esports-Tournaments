'use client';

import type {
  BracketDto,
  MatchSummaryDto,
  PublicTeamEntry,
  PublicTournamentDetail,
  StandingDto,
} from '@arenacore/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Bracket } from '@/components/bracket';
import { EmptyState, Loading } from '@/components/ui/feedback';
import { DataTable, Td } from '@/components/ui/layout';
import { StatusPill } from '@/components/ui/status';
import { api } from '@/lib/api';
import { formatDateTime, humanize } from '@/lib/format';
import { useEventStream } from '@/lib/live';

type Tab = 'bracket' | 'schedule' | 'results' | 'standings' | 'teams' | 'rules';

/** Public tournament page; every view refreshes when the live stream reports a change. */
export function TournamentLive({ initial }: { initial: PublicTournamentDetail }) {
  const slug = initial.slug;
  const client = useQueryClient();
  const base = `/public/tournaments/${slug}`;
  const detail = useQuery({
    queryKey: ['public', slug, 'detail'],
    queryFn: () => api<PublicTournamentDetail>(base),
    initialData: initial,
  });
  const t = detail.data;
  const started = t.status === 'IN_PROGRESS' || t.status === 'COMPLETED';
  const [tab, setTab] = useState<Tab>(started ? 'bracket' : 'teams');
  const [live, setLive] = useState(false);

  useEventStream(
    `/tournaments/${t.id}/stream`,
    () => {
      setLive(true);
      // Server caches are version-bumped by the same event; give the bump a moment to land.
      setTimeout(() => void client.invalidateQueries({ queryKey: ['public', slug] }), 250);
    },
    {
      types: [
        'MatchCompleted',
        'MatchReady',
        'MatchRescheduled',
        'TeamAdvanced',
        'TeamEliminated',
        'TournamentStarted',
        'TournamentCompleted',
        'DisputeOpened',
        'DisputeResolved',
        'ResultReported',
      ],
    },
  );

  const tabs: { key: Tab; label: string }[] = [
    ...(started
      ? [
          { key: 'bracket' as const, label: 'Bracket' },
          { key: 'schedule' as const, label: 'Schedule' },
          { key: 'results' as const, label: 'Results' },
          { key: 'standings' as const, label: 'Standings' },
        ]
      : []),
    { key: 'teams', label: 'Teams' },
    { key: 'rules', label: 'Rules' },
  ];

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-4 border-b border-rule pb-6">
        <div className="flex flex-wrap items-center gap-3 text-[15px] text-muted">
          <StatusPill
            status={t.status}
            label={
              t.status === 'PUBLISHED'
                ? t.registrationOpen
                  ? 'Registration open'
                  : 'Upcoming'
                : undefined
            }
          />
          <Link href={`/o/${t.organizationSlug}`} className="hover:text-ink">
            {t.organizationName}
          </Link>
          {live && started && (
            <span className="inline-flex items-center gap-1.5 text-ink">
              <span className="live-dot size-2 rounded-full bg-amber" aria-hidden /> Updating live
            </span>
          )}
        </div>
        <h1 className="text-5xl font-bold sm:text-7xl">{t.name}</h1>
        <dl className="flex flex-wrap gap-x-10 gap-y-3">
          <Fact label="Game" value={`${t.gameName}, ${t.region}`} />
          <Fact label="Format" value={`${humanize(t.format)}, ${t.teamSize}v${t.teamSize}`} />
          <Fact
            label="Matches"
            value={`Best of ${t.bestOf}${t.finalsBestOf && t.finalsBestOf !== t.bestOf ? `, finals best of ${t.finalsBestOf}` : ''}`}
          />
          <Fact label="Starts" value={formatDateTime(t.startsAt)} />
          <Fact label="Teams" value={`${t.registeredTeams} of ${t.maxTeams}`} />
          {t.prizeInfo && <Fact label="Prizes" value={t.prizeInfo} />}
        </dl>
        {t.description && <p className="max-w-2xl text-lg text-muted">{t.description}</p>}
        {t.registrationOpen && (
          <div className="flex flex-wrap items-center gap-4">
            <Link
              href={`/t/${slug}/register`}
              className="inline-flex h-11 items-center rounded-md bg-cobalt px-5 text-lg font-semibold text-white hover:bg-cobalt-ink"
            >
              Register your team
            </Link>
            <span className="text-[15px] text-muted">
              Closes {formatDateTime(t.registrationClosesAt)}
            </span>
          </div>
        )}
      </header>

      {t.status === 'COMPLETED' && <Champion slug={slug} />}

      <nav
        className="flex gap-1 overflow-x-auto border-b border-rule"
        aria-label="Tournament views"
      >
        {tabs.map((x) => (
          <button
            key={x.key}
            onClick={() => setTab(x.key)}
            aria-current={tab === x.key ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-[15px] font-semibold whitespace-nowrap ${tab === x.key ? 'border-cobalt text-ink' : 'border-transparent text-muted hover:text-ink'}`}
          >
            {x.label}
          </button>
        ))}
      </nav>

      {tab === 'bracket' && <BracketView slug={slug} />}
      {tab === 'schedule' && (
        <MatchList slug={slug} phase="upcoming" empty="No upcoming matches." includeLive />
      )}
      {tab === 'results' && <MatchList slug={slug} phase="completed" empty="No results yet." />}
      {tab === 'standings' && <Standings slug={slug} />}
      {tab === 'teams' && <Teams slug={slug} />}
      {tab === 'rules' && (
        <div className="max-w-2xl">
          <p className="mb-3 text-sm text-muted">Version {t.rulesVersion}</p>
          <div className="text-[17px] leading-relaxed whitespace-pre-line">
            {t.rules || 'The organizer hasn’t published rules yet.'}
          </div>
        </div>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-[17px] font-semibold">{value}</dd>
    </div>
  );
}

function usePublic<T>(slug: string, view: string, path: string) {
  return useQuery({ queryKey: ['public', slug, view], queryFn: () => api<T>(path) });
}

function Champion({ slug }: { slug: string }) {
  const standings = usePublic<StandingDto[]>(
    slug,
    'standings',
    `/public/tournaments/${slug}/standings`,
  );
  const winner = standings.data?.find((s) => s.placement === 1);
  if (!winner) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-l-4 border-win pl-4">
      <span className="text-[15px] text-muted">Champion</span>
      <Link
        href={`/teams/${winner.teamId}`}
        className="font-display text-4xl font-bold text-win hover:underline"
      >
        {winner.teamName}
      </Link>
      <span className="text-[15px] text-muted">
        {winner.wins} wins, {winner.losses} {winner.losses === 1 ? 'loss' : 'losses'}
      </span>
    </div>
  );
}

function BracketView({ slug }: { slug: string }) {
  const bracket = usePublic<BracketDto>(slug, 'bracket', `/public/tournaments/${slug}/bracket`);
  if (bracket.isPending) return <Loading label="Loading the bracket" />;
  if (!bracket.data || bracket.data.stages.length === 0)
    return <EmptyState title="The bracket appears when the tournament starts" />;
  return <Bracket bracket={bracket.data} />;
}

function MatchList({
  slug,
  phase,
  empty,
  includeLive,
}: {
  slug: string;
  phase: 'upcoming' | 'completed';
  empty: string;
  includeLive?: boolean;
}) {
  const matches = usePublic<MatchSummaryDto[]>(
    slug,
    `matches-${phase}`,
    `/public/tournaments/${slug}/matches?phase=${phase}`,
  );
  const live = usePublic<MatchSummaryDto[]>(
    slug,
    'matches-live',
    `/public/tournaments/${slug}/matches?phase=live`,
  );
  if (matches.isPending) return <Loading />;
  const rows = [...(includeLive ? (live.data ?? []) : []), ...(matches.data ?? [])];
  if (phase === 'completed') rows.reverse();
  if (rows.length === 0) return <EmptyState title={empty} />;
  return (
    <ul className="flex flex-col divide-y divide-rule border-y border-rule">
      {rows.map((m) => (
        <li
          key={m.id}
          className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-3 sm:grid-cols-[180px_1fr_auto_1fr]"
        >
          <div className="col-span-3 flex items-center gap-2 text-sm text-muted sm:col-span-1">
            <span>{m.roundName}</span>
            <span>{phase === 'completed' ? '' : formatDateTime(m.scheduledAt)}</span>
            {['READY', 'IN_PROGRESS', 'RESULT_PENDING', 'DISPUTED'].includes(m.status) && (
              <StatusPill
                status={m.status}
                label={m.status === 'DISPUTED' ? 'Under review' : 'Live'}
              />
            )}
          </div>
          <TeamName name={m.a?.teamName} won={m.winnerSlot === 'A'} />
          <span className="text-center font-display text-2xl font-bold">
            {m.scoreA !== null && m.scoreB !== null
              ? `${m.scoreA} : ${m.scoreB}`
              : m.status === 'FORFEITED'
                ? 'FF'
                : 'vs'}
          </span>
          <TeamName name={m.b?.teamName} won={m.winnerSlot === 'B'} alignEnd />
        </li>
      ))}
    </ul>
  );
}

function TeamName({ name, won, alignEnd }: { name?: string; won: boolean; alignEnd?: boolean }) {
  return (
    <span
      className={`truncate text-[17px] ${alignEnd ? 'text-right sm:text-left' : 'text-left sm:text-right'} ${won ? 'font-bold text-win' : 'font-semibold'}`}
    >
      {name ?? 'TBD'}
    </span>
  );
}

function Standings({ slug }: { slug: string }) {
  const standings = usePublic<StandingDto[]>(
    slug,
    'standings',
    `/public/tournaments/${slug}/standings`,
  );
  if (standings.isPending) return <Loading />;
  return (
    <DataTable head={['Place', 'Team', 'Seed', 'Won', 'Lost']}>
      {standings.data?.map((s) => (
        <tr key={s.registrationId} className={s.eliminated ? 'text-muted' : ''}>
          <Td className="font-display text-2xl font-bold">{s.placement ?? '–'}</Td>
          <Td>
            <Link href={`/teams/${s.teamId}`} className="font-semibold text-ink hover:text-cobalt">
              {s.teamName}
            </Link>
            {!s.eliminated && s.placement === null && (
              <span className="ml-2 text-sm text-win">Still in</span>
            )}
          </Td>
          <Td>{s.seed ?? '–'}</Td>
          <Td>{s.wins}</Td>
          <Td>{s.losses}</Td>
        </tr>
      ))}
    </DataTable>
  );
}

function Teams({ slug }: { slug: string }) {
  const teams = usePublic<PublicTeamEntry[]>(slug, 'teams', `/public/tournaments/${slug}/teams`);
  if (teams.isPending) return <Loading />;
  if (!teams.data?.length)
    return (
      <EmptyState title="No teams accepted yet">
        Accepted teams are listed here as the organizer approves them.
      </EmptyState>
    );
  return (
    <ul className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
      {teams.data.map((team) => (
        <li key={team.registrationId} className="flex items-center gap-3 border-b border-rule py-3">
          <span className="w-7 font-display text-xl font-bold text-muted">{team.seed ?? ''}</span>
          <Link
            href={`/teams/${team.teamId}`}
            className="min-w-0 flex-1 truncate text-[17px] font-semibold hover:text-cobalt"
          >
            {team.teamName}
          </Link>
          {team.tag && <span className="text-sm text-muted">{team.tag}</span>}
        </li>
      ))}
    </ul>
  );
}

'use client';

import type { GameDto, Page, PublicTournamentSummary } from '@arenacore/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorNote, Loading } from '@/components/ui/feedback';
import { StatusPill } from '@/components/ui/status';
import { api } from '@/lib/api';
import { humanize } from '@/lib/format';
import { useApi } from '@/lib/hooks';

const PHASES = [
  { key: '', label: 'All' },
  { key: 'live', label: 'Live now' },
  { key: 'upcoming', label: 'Open and upcoming' },
  { key: 'completed', label: 'Finished' },
] as const;

const day = new Intl.DateTimeFormat(undefined, { day: 'numeric' });
const month = new Intl.DateTimeFormat(undefined, { month: 'short' });
const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export function Discovery() {
  const [q, setQ] = useState('');
  const [phase, setPhase] = useState<(typeof PHASES)[number]['key']>('');
  const [game, setGame] = useState('');
  const query = useDeferredValue(q);
  const games = useApi<GameDto[]>('/games', { publicRoute: true });
  const params = new URLSearchParams({
    limit: '20',
    ...(query.trim() ? { q: query.trim() } : {}),
    ...(phase ? { phase } : {}),
    ...(game ? { game } : {}),
  });
  const list = useInfiniteQuery({
    queryKey: ['discover', params.toString()],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      api<Page<PublicTournamentSummary>>(
        `/public/tournaments?${params}${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <section className="flex flex-col gap-5" aria-label="Tournaments">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="flex-1">
          <span className="sr-only">Search tournaments</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, region or description"
            className="h-12 w-full rounded-md border border-rule bg-surface px-4 text-lg focus:border-cobalt focus:outline-none"
          />
        </label>
        <label>
          <span className="sr-only">Game</span>
          <select
            value={game}
            onChange={(e) => setGame(e.target.value)}
            className="h-12 rounded-md border border-rule bg-surface px-3 text-[15px] font-semibold"
          >
            <option value="">Every game</option>
            {games.data?.map((g) => (
              <option key={g.slug} value={g.slug}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Tournament phase">
        {PHASES.map((p) => (
          <button
            key={p.key}
            role="tab"
            aria-selected={phase === p.key}
            onClick={() => setPhase(p.key)}
            className={`rounded-full border px-3 py-1 text-[15px] font-semibold ${phase === p.key ? 'border-ink bg-ink text-paper' : 'border-rule text-muted hover:text-ink'}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {list.isPending ? (
        <Loading label="Finding tournaments" />
      ) : list.error ? (
        <ErrorNote error={list.error} />
      ) : items.length === 0 ? (
        <EmptyState title={query ? `Nothing matches “${query}”` : 'No tournaments here yet'}>
          Try another search or phase.
        </EmptyState>
      ) : (
        <ul className="flex flex-col divide-y divide-rule border-y border-rule">
          {items.map((t) => (
            <li key={t.id}>
              <Link
                href={`/t/${t.slug}`}
                className="group grid grid-cols-[64px_1fr] items-center gap-5 py-4 sm:grid-cols-[64px_1fr_auto]"
              >
                <time
                  dateTime={t.startsAt}
                  className="flex flex-col items-center rounded-md border border-rule bg-surface py-1.5 leading-none"
                >
                  <span className="font-display text-3xl font-bold">
                    {day.format(new Date(t.startsAt))}
                  </span>
                  <span className="text-sm text-muted">{month.format(new Date(t.startsAt))}</span>
                </time>
                <div className="min-w-0">
                  <p className="truncate font-display text-2xl font-bold group-hover:text-cobalt">
                    {t.name}
                  </p>
                  <p className="text-[15px] text-muted">
                    {t.gameName}, {t.region}. {humanize(t.format)}, {t.teamSize}v{t.teamSize}.
                    Hosted by {t.organizationName}. Starts {time.format(new Date(t.startsAt))}.
                  </p>
                </div>
                <div className="col-start-2 flex items-center gap-4 sm:col-start-auto">
                  <span className="text-[15px] text-muted">
                    <span className="font-display text-xl font-bold text-ink">
                      {t.registeredTeams}
                    </span>
                    /{t.maxTeams} teams
                  </span>
                  <StatusPill
                    status={t.status}
                    label={t.status === 'PUBLISHED' ? 'Registration' : undefined}
                  />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {list.hasNextPage && (
        <div>
          <Button
            variant="secondary"
            busy={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            Show more tournaments
          </Button>
        </div>
      )}
    </section>
  );
}

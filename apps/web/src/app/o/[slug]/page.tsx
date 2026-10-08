import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { LeaderboardRow } from '@arenacore/shared';
import { fetchPublic } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Leaderboard' };

export default async function LeaderboardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const rows = await fetchPublic<LeaderboardRow[]>(`/public/orgs/${slug}/leaderboard`, 30);
  if (!rows) notFound();
  return (
    <div className="flex flex-col gap-8">
      <header className="border-b border-rule pb-6">
        <h1 className="text-6xl font-bold">Leaderboard</h1>
        <p className="mt-2 text-lg text-muted">
          Every team that has played in this organization’s tournaments, ranked by titles, then
          match wins.
        </p>
      </header>
      {rows.length === 0 ? (
        <p className="text-[15px] text-muted">No tournaments have started yet.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-rule border-y border-rule">
          {rows.map((r) => (
            <li
              key={r.teamId}
              className="grid grid-cols-[56px_1fr_auto] items-center gap-4 py-3 sm:grid-cols-[56px_1fr_repeat(3,96px)]"
            >
              <span className="font-display text-3xl font-bold text-muted">{r.rank}</span>
              <Link
                href={`/teams/${r.teamId}`}
                className="truncate text-[17px] font-semibold hover:text-cobalt"
              >
                {r.teamName}
              </Link>
              <span className="text-right text-[15px] sm:text-center">
                <span className="font-display text-xl font-bold">{r.titles}</span>{' '}
                <span className="text-muted">titles</span>
              </span>
              <span className="hidden text-center text-[15px] sm:block">
                {r.wins}–{r.losses}
              </span>
              <span className="hidden text-center text-[15px] text-muted sm:block">
                {r.tournaments} events
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

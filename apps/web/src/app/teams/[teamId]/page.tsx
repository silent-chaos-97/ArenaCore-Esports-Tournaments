import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { TeamProfileDto } from '@arenacore/shared';
import { formatDate, humanize } from '@/lib/format';
import { fetchPublic } from '@/lib/server-api';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ teamId: string }>;
}): Promise<Metadata> {
  const { teamId } = await params;
  const team = await fetchPublic<TeamProfileDto>(`/public/teams/${teamId}`);
  return { title: team?.name ?? 'Team not found' };
}

export default async function TeamProfilePage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  const team = await fetchPublic<TeamProfileDto>(`/public/teams/${teamId}`);
  if (!team) notFound();
  const { record } = team;
  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-4 border-b border-rule pb-6">
        <h1 className="text-6xl font-bold">
          {team.name} {team.tag && <span className="text-muted">[{team.tag}]</span>}
        </h1>
        <dl className="flex flex-wrap gap-x-10 gap-y-3">
          {[
            ['Titles', record.titles],
            ['Tournaments', record.tournaments],
            ['Match wins', record.wins],
            ['Match losses', record.losses],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-sm text-muted">{label}</dt>
              <dd className="font-display text-5xl font-bold">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-[15px] text-muted">
          {team.members
            .map((m) => `${m.displayName} (${humanize(m.role).toLowerCase()})`)
            .join(', ')}
        </p>
      </header>
      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Match history</h2>
        {team.history.length === 0 ? (
          <p className="text-[15px] text-muted">No completed matches yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-rule border-y border-rule">
            {team.history.map((h) => (
              <li
                key={h.matchId}
                className="grid grid-cols-[56px_1fr_auto] items-center gap-4 py-3"
              >
                <span
                  className={`font-display text-2xl font-bold ${h.result === 'WIN' ? 'text-win' : 'text-loss'}`}
                >
                  {h.result === 'WIN' ? 'W' : 'L'}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[17px] font-semibold">
                    vs{' '}
                    {h.opponentTeamId ? (
                      <Link href={`/teams/${h.opponentTeamId}`} className="hover:text-cobalt">
                        {h.opponentName}
                      </Link>
                    ) : (
                      'TBD'
                    )}
                  </p>
                  <p className="text-sm text-muted">
                    {h.tournamentName}, {h.roundName}, {formatDate(h.completedAt)}
                  </p>
                </div>
                <span className="font-display text-2xl font-bold">
                  {h.forfeit ? 'FF' : `${h.scoreFor ?? ''} : ${h.scoreAgainst ?? ''}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

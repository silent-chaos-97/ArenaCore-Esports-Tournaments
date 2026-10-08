import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { PublicTournamentDetail } from '@arenacore/shared';
import { TournamentLive } from '@/components/public/tournament-live';
import { fetchPublic } from '@/lib/server-api';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const t = await fetchPublic<PublicTournamentDetail>(`/public/tournaments/${slug}`);
  if (!t) return { title: 'Tournament not found' };
  return {
    title: t.name,
    description:
      t.description ??
      `${t.gameName} ${t.format.replace('_', ' ').toLowerCase()} in ${t.region}, hosted by ${t.organizationName}.`,
  };
}

export default async function TournamentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tournament = await fetchPublic<PublicTournamentDetail>(`/public/tournaments/${slug}`);
  if (!tournament) notFound();
  return <TournamentLive initial={tournament} />;
}

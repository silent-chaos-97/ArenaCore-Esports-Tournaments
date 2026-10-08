'use client';

import type { PublicTournamentDetail, RegistrationDto, TeamDto } from '@arenacore/shared';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { RosterPicker, type RosterChoice } from '@/components/player/roster-picker';
import { RequireAuth } from '@/components/require-auth';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorNote, Loading } from '@/components/ui/feedback';
import { Checkbox, Field, Select } from '@/components/ui/field';
import { PageHeader, Section } from '@/components/ui/layout';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';

/** Workflow B: pick a team and roster, accept the rules, submit. */
function Register() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const tournament = useApi<PublicTournamentDetail>(`/public/tournaments/${slug}`, {
    publicRoute: true,
  });
  const teams = useApi<TeamDto[]>('/teams/mine', { key: ['me', 'teams'] });
  const [teamId, setTeamId] = useState('');
  const [roster, setRoster] = useState<RosterChoice[]>([]);
  const [accepted, setAccepted] = useState(false);
  const [result, setResult] = useState<RegistrationDto | null>(null);
  const t = tournament.data;
  const submit = useAction<void, RegistrationDto>(
    () => ({
      path: `/tournaments/${t!.id}/registrations`,
      method: 'POST',
      body: { teamId, members: roster, acceptRules: accepted, rulesVersion: t!.rulesVersion },
    }),
    { idempotent: true, invalidate: [['me']], onSuccess: setResult },
  );

  if (tournament.isPending || teams.isPending) return <Loading />;
  if (tournament.error || !t) return <ErrorNote error={tournament.error} />;
  const manageable = (teams.data ?? []).filter((team) =>
    team.members.some(
      (m) => m.playerId === user?.playerId && (m.role === 'CAPTAIN' || m.role === 'MANAGER'),
    ),
  );
  const team = manageable.find((x) => x.id === teamId);

  if (result) {
    return (
      <div className="flex max-w-2xl flex-col gap-4">
        <PageHeader
          title={
            result.status === 'VALIDATION_FAILED'
              ? 'Your roster needs changes'
              : 'Registration sent'
          }
        />
        {result.status === 'VALIDATION_FAILED' ? (
          <>
            <ul className="list-disc pl-5 text-[15px] text-loss">
              {result.validationErrors.map((e, i) => (
                <li key={i}>{e.message}</li>
              ))}
            </ul>
            <Link
              href={`/me/teams/${result.teamId}?fix=${result.id}`}
              className="font-semibold text-cobalt hover:underline"
            >
              Fix the roster
            </Link>
          </>
        ) : (
          <p className="text-[15px]">
            {result.status === 'APPROVED'
              ? `${result.teamName} is in.`
              : `${result.teamName} is waiting for the organizer to review the registration.`}{' '}
            We’ll notify your team.
          </p>
        )}
        <div>
          <Button onClick={() => router.push('/me')}>Go to my dashboard</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <PageHeader
        title={`Register for ${t.name}`}
        meta={
          <>
            <span>
              {t.teamSize} players
              {t.maxSubstitutes ? ` plus up to ${t.maxSubstitutes} substitutes` : ''}
            </span>
            <span>Registration closes {formatDateTime(t.registrationClosesAt)}</span>
          </>
        }
      />
      {!t.registrationOpen ? (
        <EmptyState title="Registration is closed" />
      ) : manageable.length === 0 ? (
        <EmptyState
          title="You need a team you captain or manage"
          action={
            <Link href="/me/teams" className="font-semibold text-cobalt hover:underline">
              Create a team
            </Link>
          }
        />
      ) : (
        <>
          <Section title="Team">
            <div className="max-w-sm">
              <Field label="Register this team">
                {(p) => (
                  <Select {...p} value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                    <option value="">Choose a team</option>
                    {manageable.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            {team && (
              <RosterPicker
                key={team.id}
                team={team}
                teamSize={t.teamSize}
                maxSubstitutes={t.maxSubstitutes}
                onChange={setRoster}
              />
            )}
            {team && (
              <p className="text-sm text-muted">
                Every player needs a linked {t.gameName} account in their profile.
              </p>
            )}
          </Section>
          <Section title="Rules">
            <div className="max-h-72 overflow-y-auto rounded-lg border border-rule bg-surface p-4 text-[15px] leading-relaxed whitespace-pre-line">
              {t.rules}
            </div>
            <Checkbox
              label={`I’ve read the rules (version ${t.rulesVersion}) and my team agrees to them`}
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />
          </Section>
          <ErrorNote error={submit.error} />
          <div>
            <Button
              busy={submit.isPending}
              disabled={!teamId || !accepted || roster.length === 0}
              onClick={() => submit.mutate()}
            >
              Submit registration
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export default function RegisterPage() {
  return (
    <RequireAuth>
      <Register />
    </RequireAuth>
  );
}

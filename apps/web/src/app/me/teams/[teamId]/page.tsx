'use client';

import type { RegistrationDto, TeamDto, TeamInviteDto, TeamMemberRole } from '@arenacore/shared';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { RosterPicker, type RosterChoice } from '@/components/player/roster-picker';
import { Button } from '@/components/ui/button';
import { ErrorNote, Loading } from '@/components/ui/feedback';
import { Field, Select, TextInput } from '@/components/ui/field';
import { DataTable, PageHeader, Section, Td } from '@/components/ui/layout';
import { StatusPill } from '@/components/ui/status';
import { useAuth } from '@/lib/auth';
import { humanize } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';

function TeamManager() {
  const { teamId } = useParams<{ teamId: string }>();
  const fixId = useSearchParams().get('fix');
  const { user } = useAuth();
  const router = useRouter();
  const path = `/teams/${teamId}`;
  const team = useApi<TeamDto>(path, { key: ['me', 'team', teamId] });
  const me = team.data?.members.find((m) => m.playerId === user?.playerId);
  const manager = me?.role === 'CAPTAIN' || me?.role === 'MANAGER';
  const invites = useApi<TeamInviteDto[]>(manager ? `${path}/invites` : null, {
    key: ['me', 'team', teamId, 'invites'],
  });
  const invalidate = [['me']];
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'PLAYER' | 'SUBSTITUTE' | 'MANAGER'>('PLAYER');

  const invite = useAction(
    () => ({ path: `${path}/invites`, method: 'POST', body: { email, role } }),
    {
      success: 'Invitation sent',
      invalidate,
      onSuccess: () => setEmail(''),
    },
  );
  const revoke = useAction((id: string) => ({ path: `${path}/invites/${id}`, method: 'DELETE' }), {
    success: 'Invitation revoked',
    invalidate,
  });
  const update = useAction(
    (input: { memberId: string; role?: TeamMemberRole; active?: boolean }) => ({
      path: `${path}/members/${input.memberId}`,
      method: 'PATCH',
      body: { role: input.role, active: input.active },
    }),
    { success: 'Roster updated', invalidate },
  );
  const remove = useAction(
    (memberId: string) => ({ path: `${path}/members/${memberId}`, method: 'DELETE' }),
    {
      success: 'Removed from team',
      invalidate,
      onSuccess: () => undefined,
    },
  );

  if (team.isPending) return <Loading />;
  if (team.error) return <ErrorNote error={team.error} />;
  const t = team.data;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={t.name} meta={t.tag ? <span>[{t.tag}]</span> : undefined} />
      {fixId && manager && (
        <FixRoster registrationId={fixId} team={t} onDone={() => router.replace('/me')} />
      )}
      <Section title="Roster">
        <ErrorNote error={update.error ?? remove.error} />
        <DataTable head={['Player', 'Role', 'Status', '']}>
          {t.members.map((m) => (
            <tr key={m.id}>
              <Td className="font-semibold">{m.displayName}</Td>
              <Td>
                {manager && m.playerId !== user?.playerId ? (
                  <Select
                    aria-label={`Role for ${m.displayName}`}
                    value={m.role}
                    className="w-40"
                    onChange={(e) =>
                      update.mutate({ memberId: m.id, role: e.target.value as TeamMemberRole })
                    }
                  >
                    {(me?.role === 'CAPTAIN'
                      ? ['CAPTAIN', 'MANAGER', 'PLAYER', 'SUBSTITUTE']
                      : ['MANAGER', 'PLAYER', 'SUBSTITUTE']
                    ).map((r) => (
                      <option key={r} value={r}>
                        {humanize(r)}
                      </option>
                    ))}
                  </Select>
                ) : (
                  humanize(m.role)
                )}
              </Td>
              <Td>
                {manager && m.role !== 'CAPTAIN' ? (
                  <button
                    className="text-[15px] font-semibold text-cobalt hover:underline"
                    onClick={() => update.mutate({ memberId: m.id, active: !m.active })}
                  >
                    {m.active ? 'Active' : 'Inactive'}
                  </button>
                ) : m.active ? (
                  'Active'
                ) : (
                  'Inactive'
                )}
              </Td>
              <Td className="text-right">
                {m.playerId === user?.playerId && m.role !== 'CAPTAIN' ? (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      remove.mutate(m.id, { onSuccess: () => router.replace('/me/teams') })
                    }
                  >
                    Leave team
                  </Button>
                ) : (
                  manager &&
                  m.role !== 'CAPTAIN' && (
                    <Button variant="ghost" onClick={() => remove.mutate(m.id)}>
                      Remove
                    </Button>
                  )
                )}
              </Td>
            </tr>
          ))}
        </DataTable>
        {me?.role === 'CAPTAIN' && (
          <p className="text-sm text-muted">
            To step down, give another member the captain role first.
          </p>
        )}
      </Section>
      {manager && (
        <Section title="Invite a player">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1">
              <Field label="Player’s email" hint="They need an ArenaCore account.">
                {(p) => (
                  <TextInput
                    {...p}
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                )}
              </Field>
            </div>
            <div className="w-44">
              <Field label="Role">
                {(p) => (
                  <Select
                    {...p}
                    value={role}
                    onChange={(e) => setRole(e.target.value as typeof role)}
                  >
                    <option value="PLAYER">Player</option>
                    <option value="SUBSTITUTE">Substitute</option>
                    <option value="MANAGER">Manager</option>
                  </Select>
                )}
              </Field>
            </div>
            <Button busy={invite.isPending} disabled={!email} onClick={() => invite.mutate()}>
              Send invitation
            </Button>
          </div>
          <ErrorNote error={invite.error ?? revoke.error} />
          {(invites.data?.length ?? 0) > 0 && (
            <ul className="flex flex-col divide-y divide-rule rounded-lg border border-rule bg-surface">
              {invites.data!.map((i) => (
                <li key={i.id} className="flex items-center justify-between px-4 py-2 text-[15px]">
                  <span>
                    {i.playerName}{' '}
                    <span className="text-muted">({humanize(i.role).toLowerCase()}, waiting)</span>
                  </span>
                  <Button variant="ghost" onClick={() => revoke.mutate(i.id)}>
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
    </div>
  );
}

function FixRoster({
  registrationId,
  team,
  onDone,
}: {
  registrationId: string;
  team: TeamDto;
  onDone: () => void;
}) {
  const registration = useApi<RegistrationDto>(`/registrations/${registrationId}`, {
    key: ['me', 'registration', registrationId],
  });
  const tournament = useApi<{
    teamSize: number;
    maxSubstitutes: number;
    rulesVersion: number;
    rules: string;
  }>(registration.data ? `/public/tournaments/${registration.data.tournamentSlug}` : null, {
    publicRoute: true,
  });
  const [roster, setRoster] = useState<RosterChoice[]>([]);
  const save = useAction(
    () => ({
      path: `/registrations/${registrationId}/roster`,
      method: 'PUT',
      body: {
        members: roster,
        acceptRules: true,
        rulesVersion: tournament.data?.rulesVersion ?? 1,
      },
    }),
    { success: 'Roster resubmitted', invalidate: [['me']], onSuccess: onDone },
  );
  if (!registration.data) return null;
  return (
    <Section title={`Fix your roster for ${registration.data.tournamentName}`}>
      <StatusPill status={registration.data.status} />
      <ul className="list-disc pl-5 text-[15px] text-loss">
        {registration.data.validationErrors.map((e, i) => (
          <li key={i}>{e.message}</li>
        ))}
      </ul>
      <RosterPicker
        team={team}
        teamSize={tournament.data?.teamSize ?? 1}
        maxSubstitutes={tournament.data?.maxSubstitutes ?? 0}
        onChange={setRoster}
      />
      <ErrorNote error={save.error} />
      <div>
        <Button busy={save.isPending} onClick={() => save.mutate()}>
          Resubmit roster
        </Button>
      </div>
    </Section>
  );
}

export default function TeamPage() {
  return (
    <Suspense fallback={<Loading />}>
      <TeamManager />
    </Suspense>
  );
}

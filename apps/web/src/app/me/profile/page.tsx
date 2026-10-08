'use client';

import type { GameDto, PlayerProfileDto } from '@arenacore/shared';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ErrorNote, Loading } from '@/components/ui/feedback';
import { Field, Select, TextInput } from '@/components/ui/field';
import { DataTable, PageHeader, Section, Td } from '@/components/ui/layout';
import { humanize } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';

export default function ProfilePage() {
  const profile = useApi<PlayerProfileDto>('/players/me', { key: ['me', 'profile'] });
  if (profile.isPending) return <Loading />;
  if (profile.error) return <ErrorNote error={profile.error} />;
  return (
    <div className="flex max-w-3xl flex-col gap-10">
      <PageHeader title="Profile and game accounts" />
      <ProfileForm profile={profile.data} />
      <GameAccounts profile={profile.data} />
    </div>
  );
}

function ProfileForm({ profile }: { profile: PlayerProfileDto }) {
  const [form, setForm] = useState({
    displayName: profile.displayName,
    country: profile.country ?? '',
    dateOfBirth: profile.dateOfBirth ?? '',
  });
  const save = useAction(
    () => ({
      path: '/players/me',
      method: 'PATCH',
      body: {
        displayName: form.displayName,
        country: form.country || null,
        dateOfBirth: form.dateOfBirth || null,
      },
    }),
    { success: 'Profile saved', invalidate: [['me']] },
  );
  return (
    <Section title="Profile">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Display name">
          {(p) => (
            <TextInput
              {...p}
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            />
          )}
        </Field>
        <Field label="Country" hint="Two-letter code, for example SE.">
          {(p) => (
            <TextInput
              {...p}
              maxLength={2}
              value={form.country}
              onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase() })}
            />
          )}
        </Field>
        <Field label="Date of birth" hint="Only used to check age limits. Never shown publicly.">
          {(p) => (
            <TextInput
              {...p}
              type="date"
              value={form.dateOfBirth}
              onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
            />
          )}
        </Field>
      </div>
      <ErrorNote error={save.error} />
      <div>
        <Button busy={save.isPending} onClick={() => save.mutate()}>
          Save profile
        </Button>
      </div>
    </Section>
  );
}

function GameAccounts({ profile }: { profile: PlayerProfileDto }) {
  const games = useApi<GameDto[]>('/games', { publicRoute: true });
  const [form, setForm] = useState({ gameId: '', externalPlayerId: '', username: '', region: '' });
  const link = useAction(
    () => ({
      path: '/players/me/game-accounts',
      method: 'POST',
      body: { ...form, region: form.region || undefined },
    }),
    {
      success: 'Game account linked',
      invalidate: [['me']],
      onSuccess: () => setForm({ gameId: '', externalPlayerId: '', username: '', region: '' }),
    },
  );
  const unlink = useAction(
    (id: string) => ({ path: `/players/me/game-accounts/${id}`, method: 'DELETE' }),
    { success: 'Game account removed', invalidate: [['me']] },
  );
  return (
    <Section title="Game accounts">
      <p className="max-w-prose text-[15px] text-muted">
        Tournaments require an account for their game. Each in-game identity can belong to only one
        ArenaCore player.
      </p>
      {profile.gameAccounts.length > 0 && (
        <DataTable head={['Game', 'Account', 'Verification', '']}>
          {profile.gameAccounts.map((a) => (
            <tr key={a.id}>
              <Td className="font-semibold">{a.gameName}</Td>
              <Td>
                {a.username} <span className="text-sm text-muted">{a.externalPlayerId}</span>
              </Td>
              <Td className="text-muted">{humanize(a.verificationStatus)}</Td>
              <Td className="text-right">
                <Button variant="ghost" onClick={() => unlink.mutate(a.id)}>
                  Remove
                </Button>
              </Td>
            </tr>
          ))}
        </DataTable>
      )}
      <ErrorNote error={unlink.error} />
      <div className="grid gap-4 rounded-lg border border-rule bg-surface p-5 sm:grid-cols-2">
        <Field label="Game">
          {(p) => (
            <Select
              {...p}
              value={form.gameId}
              onChange={(e) => setForm({ ...form, gameId: e.target.value })}
            >
              <option value="">Choose a game</option>
              {games.data?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="In-game ID" hint="For example Name#TAG or your Steam ID.">
          {(p) => (
            <TextInput
              {...p}
              value={form.externalPlayerId}
              onChange={(e) => setForm({ ...form, externalPlayerId: e.target.value })}
            />
          )}
        </Field>
        <Field label="Display name in game">
          {(p) => (
            <TextInput
              {...p}
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          )}
        </Field>
        <Field label="Region (optional)">
          {(p) => (
            <TextInput
              {...p}
              value={form.region}
              onChange={(e) => setForm({ ...form, region: e.target.value })}
            />
          )}
        </Field>
        <div className="sm:col-span-2">
          <ErrorNote error={link.error} />
          <Button
            busy={link.isPending}
            disabled={!form.gameId || form.externalPlayerId.length < 2 || form.username.length < 2}
            onClick={() => link.mutate()}
          >
            Link account
          </Button>
        </div>
      </div>
    </Section>
  );
}

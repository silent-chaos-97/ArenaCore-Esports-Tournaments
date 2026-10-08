'use client';

import type { TeamDto } from '@arenacore/shared';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorNote, Loading } from '@/components/ui/feedback';
import { Field, TextInput } from '@/components/ui/field';
import { PageHeader, Section } from '@/components/ui/layout';
import { humanize } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';

export default function TeamsPage() {
  const teams = useApi<TeamDto[]>('/teams/mine', { key: ['me', 'teams'] });
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const create = useAction(
    () => ({ path: '/teams', method: 'POST', body: { name, tag: tag || undefined } }),
    {
      success: 'Team created',
      invalidate: [['me']],
      onSuccess: () => {
        setName('');
        setTag('');
      },
    },
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Teams" />
      {teams.isPending ? (
        <Loading />
      ) : teams.data?.length === 0 ? (
        <EmptyState title="You’re not on a team yet">
          Create one below, or ask a captain to invite you by email.
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {teams.data?.map((t) => (
            <li key={t.id}>
              <Link
                href={`/me/teams/${t.id}`}
                className="block rounded-lg border border-rule bg-surface p-4 hover:border-cobalt"
              >
                <p className="font-display text-2xl font-bold">
                  {t.name} {t.tag && <span className="text-muted">[{t.tag}]</span>}
                </p>
                <p className="mt-1 text-[15px] text-muted">
                  {t.members
                    .map((m) => `${m.displayName} (${humanize(m.role).toLowerCase()})`)
                    .join(', ')}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Section title="Create a team">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <Field label="Team name">
              {(p) => <TextInput {...p} value={name} onChange={(e) => setName(e.target.value)} />}
            </Field>
          </div>
          <div className="w-32">
            <Field label="Tag">
              {(p) => (
                <TextInput
                  {...p}
                  maxLength={5}
                  placeholder="ABC"
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                />
              )}
            </Field>
          </div>
          <Button
            busy={create.isPending}
            disabled={name.trim().length < 2}
            onClick={() => create.mutate()}
          >
            Create team
          </Button>
        </div>
        <p className="text-sm text-muted">
          You become the captain. Captains register the team for tournaments and report scores.
        </p>
        <ErrorNote error={create.error} />
      </Section>
    </div>
  );
}

'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { RequireAuth } from '@/components/require-auth';
import { Button } from '@/components/ui/button';
import { ErrorNote, Loading } from '@/components/ui/feedback';
import { Field, TextInput } from '@/components/ui/field';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

function ConsoleEntry() {
  const { user, activeOrgId, setActiveOrgId, reload } = useAuth();
  const router = useRouter();
  const creating = useSearchParams().get('new') === '1';
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!creating && activeOrgId) router.replace(`/console/${activeOrgId}`);
  }, [creating, activeOrgId, router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const org = await api<{ id: string }>('/orgs', { method: 'POST', body: { name } });
      await reload();
      setActiveOrgId(org.id);
      router.replace(`/console/${org.id}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!creating && activeOrgId) return <Loading label="Opening your console" />;
  return (
    <div className="mx-auto flex max-w-md flex-col gap-5 pt-6">
      <h1 className="text-5xl font-bold">Create an organization</h1>
      <p className="text-[15px] text-muted">
        Your organization owns its tournaments, staff and audit history. You can invite admins and
        referees once it exists.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Organization name" hint="For example, the league or community you run.">
          {(p) => (
            <TextInput
              {...p}
              required
              minLength={2}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <ErrorNote error={error} />
        <Button type="submit" busy={busy}>
          Create organization
        </Button>
      </form>
      {!user?.mfaEnabled && (
        <p className="text-sm text-muted">
          Owners need two-step sign-in turned on before managing tournaments.
        </p>
      )}
    </div>
  );
}

export default function ConsolePage() {
  return (
    <RequireAuth>
      <Suspense>
        <ConsoleEntry />
      </Suspense>
    </RequireAuth>
  );
}

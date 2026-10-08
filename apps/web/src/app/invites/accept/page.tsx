'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { RequireAuth } from '@/components/require-auth';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/ui/feedback';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

function Accept() {
  const token = useSearchParams().get('token') ?? '';
  const router = useRouter();
  const { reload, setActiveOrgId } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function accept() {
    setBusy(true);
    try {
      const org = await api<{ id: string; name: string }>('/invites/accept', {
        method: 'POST',
        body: { token },
      });
      await reload();
      setActiveOrgId(org.id);
      router.replace(`/console/${org.id}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 pt-6">
      <h1 className="text-5xl font-bold">Join the organization</h1>
      <p className="text-[15px] text-muted">
        You were invited to help run tournaments. Accept to open the console.
      </p>
      <ErrorNote error={error} />
      <Button busy={busy} disabled={!token} onClick={() => void accept()}>
        Accept invitation
      </Button>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <RequireAuth>
      <Suspense>
        <Accept />
      </Suspense>
    </RequireAuth>
  );
}

'use client';

import type { AuthTokens } from '@arenacore/shared';
import { useState, type FormEvent } from 'react';
import { RequireAuth } from '@/components/require-auth';
import { Button } from '@/components/ui/button';
import { ErrorNote, useToast } from '@/components/ui/feedback';
import { Field, TextInput } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/layout';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface Enrolment {
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
}

function Security() {
  const { user, adoptTokens, reload } = useAuth();
  const toast = useToast();
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const privileged = user?.memberships.some((m) => m.role === 'OWNER' || m.role === 'ADMIN');

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const start = () =>
    run(async () => setEnrolment(await api<Enrolment>('/auth/mfa/setup', { method: 'POST' })));
  const enable = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await adoptTokens(
        await api<AuthTokens>('/auth/mfa/enable', { method: 'POST', body: { code } }),
      );
      setEnrolment(null);
      setCode('');
      toast('Two-step sign-in turned on');
    });
  };
  const disable = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api('/auth/mfa/disable', { method: 'POST', body: { code } });
      setCode('');
      await reload().catch(() => undefined);
      toast('Two-step sign-in turned off');
    });
  };

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <PageHeader title="Sign-in security" meta={<span>{user?.email}</span>} />
      <section className="flex flex-col gap-3">
        <h2 className="text-2xl font-semibold">Two-step sign-in</h2>
        <p className="text-[15px] text-muted">
          {user?.mfaEnabled
            ? 'On. You’ll be asked for a code from your authenticator app each time you sign in.'
            : privileged
              ? 'Owners and admins must turn this on before managing tournaments.'
              : 'Protect your account with a code from an authenticator app.'}
        </p>
        {!user?.mfaEnabled && !enrolment && (
          <div>
            <Button onClick={() => void start()} busy={busy}>
              Set up authenticator
            </Button>
          </div>
        )}
        {enrolment && (
          <form
            onSubmit={enable}
            className="flex flex-col gap-4 rounded-lg border border-rule bg-surface p-5"
          >
            <p className="text-[15px]">
              Scan this code with your authenticator app, then enter the 6-digit code it shows.
            </p>
            <img
              src={enrolment.qrDataUrl}
              alt="QR code for your authenticator app"
              className="size-44 rounded bg-white p-2"
            />
            <p className="text-sm text-muted">
              Can’t scan? Enter this key manually:{' '}
              <code className="font-semibold break-all text-ink">{enrolment.secret}</code>
            </p>
            <Field label="Code">
              {(p) => (
                <TextInput
                  {...p}
                  inputMode="numeric"
                  maxLength={6}
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              )}
            </Field>
            <Button type="submit" busy={busy}>
              Turn on two-step sign-in
            </Button>
          </form>
        )}
        {user?.mfaEnabled && (
          <form onSubmit={disable} className="flex flex-col gap-3">
            <Field
              label="Current code"
              hint={privileged ? 'Owners and admins can’t turn this off.' : undefined}
            >
              {(p) => (
                <TextInput
                  {...p}
                  inputMode="numeric"
                  maxLength={6}
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              )}
            </Field>
            <div>
              <Button type="submit" variant="secondary" busy={busy}>
                Turn off two-step sign-in
              </Button>
            </div>
          </form>
        )}
        <ErrorNote error={error} />
      </section>
    </div>
  );
}

export default function SecurityPage() {
  return (
    <RequireAuth>
      <Security />
    </RequireAuth>
  );
}

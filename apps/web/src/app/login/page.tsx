'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/ui/feedback';
import { Field, TextInput } from '@/components/ui/field';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const next = useSearchParams().get('next') ?? '/me';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login({ email, password, mfaCode: needsCode ? mfaCode : undefined });
      router.replace(next.startsWith('/') ? next : '/me');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'MFA_REQUIRED') setNeedsCode(true);
      else setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Email">
        {(p) => (
          <TextInput
            {...p}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        )}
      </Field>
      <Field label="Password">
        {(p) => (
          <TextInput
            {...p}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
      </Field>
      {needsCode && (
        <Field
          label="Authenticator code"
          hint="Enter the 6-digit code from your authenticator app."
        >
          {(p) => (
            <TextInput
              {...p}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              autoFocus
              required
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
            />
          )}
        </Field>
      )}
      <ErrorNote error={error} />
      <Button type="submit" busy={busy}>
        {needsCode ? 'Verify and sign in' : 'Sign in'}
      </Button>
      <p className="text-[15px] text-muted">
        New to ArenaCore?{' '}
        <Link href="/register" className="font-semibold text-cobalt hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-sm pt-6">
      <h1 className="mb-6 text-5xl font-bold">Sign in</h1>
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}

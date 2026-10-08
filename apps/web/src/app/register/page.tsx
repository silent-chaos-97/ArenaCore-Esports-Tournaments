'use client';

import { registerSchema } from '@arenacore/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/ui/feedback';
import { Field, TextInput } from '@/components/ui/field';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ displayName: '', email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = registerSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setBusy(true);
    setError(null);
    try {
      await register(parsed.data);
      router.replace('/me');
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="mx-auto max-w-sm pt-6">
      <h1 className="mb-2 text-5xl font-bold">Create your account</h1>
      <p className="mb-6 text-[15px] text-muted">
        One account for playing, captaining a team and running tournaments.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field
          label="Display name"
          error={errors.displayName}
          hint="Shown on rosters and brackets."
        >
          {(p) => (
            <TextInput
              {...p}
              autoComplete="nickname"
              value={form.displayName}
              onChange={set('displayName')}
            />
          )}
        </Field>
        <Field label="Email" error={errors.email}>
          {(p) => (
            <TextInput
              {...p}
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={set('email')}
            />
          )}
        </Field>
        <Field label="Password" error={errors.password} hint="At least 10 characters.">
          {(p) => (
            <TextInput
              {...p}
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={set('password')}
            />
          )}
        </Field>
        <ErrorNote error={Object.keys(errors).length ? null : error} />
        <Button type="submit" busy={busy}>
          Create account
        </Button>
        <p className="text-[15px] text-muted">
          Already registered?{' '}
          <Link href="/login" className="font-semibold text-cobalt hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}

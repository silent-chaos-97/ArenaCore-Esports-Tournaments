'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import { Loading } from './ui/feedback';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (status === 'signed-out')
      router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
  }, [status, router]);
  if (status !== 'signed-in') return <Loading label="Checking your session" />;
  return <>{children}</>;
}

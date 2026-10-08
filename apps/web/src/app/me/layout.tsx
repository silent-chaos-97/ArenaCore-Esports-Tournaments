'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { RequireAuth } from '@/components/require-auth';

const LINKS = [
  { href: '/me', label: 'Overview' },
  { href: '/me/teams', label: 'Teams' },
  { href: '/me/profile', label: 'Profile and game accounts' },
  { href: '/me/notifications', label: 'Inbox' },
];

export default function PlayerLayout({ children }: { children: ReactNode }) {
  const path = usePathname();
  return (
    <RequireAuth>
      <nav aria-label="Player" className="mb-8 flex gap-1 overflow-x-auto border-b border-rule">
        {LINKS.map((l) => {
          const active =
            l.href === '/me'
              ? path === '/me' || path.startsWith('/me/matches')
              : path.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? 'page' : undefined}
              className={`-mb-px border-b-2 px-3 py-2 text-[15px] font-semibold whitespace-nowrap ${active ? 'border-cobalt text-ink' : 'border-transparent text-muted hover:text-ink'}`}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </RequireAuth>
  );
}

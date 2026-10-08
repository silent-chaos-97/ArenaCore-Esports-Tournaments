'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { NotificationBell } from './notification-bell';

const linkClass = (active: boolean) =>
  `rounded-md px-2.5 py-1.5 whitespace-nowrap sm:px-3 text-[15px] font-semibold ${active ? 'bg-cobalt-wash text-cobalt-ink' : 'text-muted hover:text-ink'}`;

export function SiteHeader() {
  const { status, user, logout } = useAuth();
  const path = usePathname();
  const isOrganizer = (user?.memberships.length ?? 0) > 0;
  return (
    <header className="border-b border-rule bg-surface">
      <nav
        aria-label="Main"
        className="mx-auto flex h-14 max-w-6xl items-center gap-1 px-4 sm:gap-2 sm:px-6"
      >
        <Link href="/" className="mr-1 font-display text-2xl font-bold tracking-wide sm:mr-3">
          ArenaCore
        </Link>
        <Link
          href="/"
          className={`${linkClass(path === '/' || path.startsWith('/t/'))} hidden sm:inline`}
        >
          Tournaments
        </Link>
        {status === 'signed-in' && (
          <>
            <Link href="/me" className={linkClass(path.startsWith('/me'))}>
              My matches
            </Link>
            <Link href="/console" className={linkClass(path.startsWith('/console'))}>
              {isOrganizer ? 'Console' : 'Organize'}
            </Link>
          </>
        )}
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          {status === 'signed-in' && user ? (
            <>
              <NotificationBell />
              <Link
                href="/account/security"
                className="hidden text-[15px] text-muted hover:text-ink sm:inline"
              >
                {user.displayName}
              </Link>
              <button
                onClick={() => void logout()}
                className="rounded-md px-2.5 py-1.5 whitespace-nowrap text-[15px] font-semibold text-muted hover:text-ink"
              >
                Sign out
              </button>
            </>
          ) : status === 'signed-out' ? (
            <>
              <Link
                href="/login"
                className="rounded-md px-2.5 py-1.5 whitespace-nowrap text-[15px] font-semibold text-muted hover:text-ink"
              >
                Sign in
              </Link>
              <Link
                href="/register"
                className="rounded-md bg-cobalt px-3 py-1.5 text-[15px] font-semibold text-white hover:bg-cobalt-ink"
              >
                Create account
              </Link>
            </>
          ) : null}
        </div>
      </nav>
    </header>
  );
}

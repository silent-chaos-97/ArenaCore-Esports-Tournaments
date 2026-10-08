'use client';

import Link from 'next/link';

/** Placeholder until the inbox lands in the player portal step. */
export function NotificationBell() {
  return (
    <Link
      href="/me/notifications"
      className="rounded-md px-2 py-1.5 text-[15px] font-semibold text-muted hover:text-ink"
    >
      Inbox
    </Link>
  );
}

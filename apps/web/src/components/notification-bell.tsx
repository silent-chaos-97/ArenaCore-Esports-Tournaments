'use client';

import type { NotificationDto, Page } from '@arenacore/shared';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useToast } from './ui/feedback';
import { useApi } from '@/lib/hooks';
import { useEventStream } from '@/lib/live';

/** Unread count that updates live; new notifications also refresh the player's views. */
export function NotificationBell() {
  const inbox = useApi<Page<NotificationDto> & { unread: number }>('/notifications?limit=1', {
    key: ['notifications', 'count'],
  });
  const client = useQueryClient();
  const toast = useToast();
  useEventStream(
    '/me/stream',
    (_type, data) => {
      const n = data as NotificationDto;
      toast(n.title);
      void client.invalidateQueries({ queryKey: ['notifications'] });
      void client.invalidateQueries({ queryKey: ['me'] });
    },
    { authenticated: true, types: ['notification'] },
  );
  const unread = inbox.data?.unread ?? 0;
  return (
    <Link
      href="/me/notifications"
      className="relative rounded-md px-2 py-1.5 text-[15px] font-semibold text-muted hover:text-ink"
      aria-label={unread ? `Inbox, ${unread} unread` : 'Inbox'}
    >
      Inbox
      {unread > 0 && (
        <span className="ml-1.5 inline-flex min-w-5 justify-center rounded-full bg-amber px-1.5 font-display text-sm font-bold text-ink">
          {unread}
        </span>
      )}
    </Link>
  );
}

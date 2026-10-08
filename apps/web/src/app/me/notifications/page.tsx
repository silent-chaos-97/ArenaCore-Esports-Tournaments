'use client';

import type { NotificationDto, Page } from '@arenacore/shared';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorNote, Loading } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/layout';
import { formatRelative } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';

function linkFor(n: NotificationDto): string | null {
  const data = n.data as { matchId?: string; inviteId?: string };
  if (data.matchId) return `/me/matches/${data.matchId}`;
  if (data.inviteId) return '/me';
  return null;
}

export default function InboxPage() {
  const inbox = useApi<Page<NotificationDto> & { unread: number }>('/notifications?limit=50', {
    key: ['notifications', 'list'],
  });
  const readAll = useAction(() => ({ path: '/notifications/read-all', method: 'POST' }), {
    success: 'All marked as read',
    invalidate: [['notifications']],
  });
  const read = useAction((id: string) => ({ path: `/notifications/${id}/read`, method: 'POST' }), {
    invalidate: [['notifications']],
  });

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Inbox"
        actions={
          (inbox.data?.unread ?? 0) > 0 && (
            <Button variant="secondary" busy={readAll.isPending} onClick={() => readAll.mutate()}>
              Mark all as read
            </Button>
          )
        }
      />
      {inbox.isPending ? (
        <Loading />
      ) : inbox.error ? (
        <ErrorNote error={inbox.error} />
      ) : inbox.data.items.length === 0 ? (
        <EmptyState title="Nothing yet">
          Match times, results and registration decisions show up here as they happen.
        </EmptyState>
      ) : (
        <ul className="flex flex-col divide-y divide-rule rounded-lg border border-rule bg-surface">
          {inbox.data.items.map((n) => {
            const href = linkFor(n);
            const body = (
              <>
                <p className={`text-[15px] ${n.readAt ? '' : 'font-semibold'}`}>{n.title}</p>
                <p className="text-[15px] text-muted">{n.body}</p>
              </>
            );
            return (
              <li
                key={n.id}
                className={`flex items-start gap-3 px-4 py-3 ${n.readAt ? '' : 'bg-cobalt-wash/40'}`}
              >
                <span
                  className={`mt-2 size-2 shrink-0 rounded-full ${n.readAt ? 'bg-transparent' : 'bg-cobalt'}`}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  {href ? (
                    <Link
                      href={href}
                      onClick={() => !n.readAt && read.mutate(n.id)}
                      className="block hover:text-cobalt"
                    >
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </div>
                <span className="shrink-0 text-sm text-muted">{formatRelative(n.createdAt)}</span>
                {!n.readAt && (
                  <button
                    className="shrink-0 text-sm font-semibold text-cobalt hover:underline"
                    onClick={() => read.mutate(n.id)}
                  >
                    Mark read
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

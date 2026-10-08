import { humanize } from '@/lib/format';

type Tone = 'neutral' | 'live' | 'good' | 'bad' | 'info';

const tones: Record<Tone, string> = {
  neutral: 'bg-rule/60 text-muted',
  live: 'bg-amber-wash text-ink',
  good: 'bg-win-wash text-win',
  bad: 'bg-loss-wash text-loss',
  info: 'bg-cobalt-wash text-cobalt-ink',
};

const toneOf: Record<string, Tone> = {
  // tournaments
  DRAFT: 'neutral',
  PUBLISHED: 'info',
  IN_PROGRESS: 'live',
  COMPLETED: 'good',
  CANCELLED: 'bad',
  // registrations
  SUBMITTED: 'info',
  UNDER_REVIEW: 'info',
  VALIDATION_FAILED: 'bad',
  APPROVED: 'good',
  REJECTED: 'bad',
  CHECKED_IN: 'good',
  WITHDRAWN: 'neutral',
  // matches
  PENDING: 'neutral',
  SCHEDULED: 'neutral',
  CHECK_IN_OPEN: 'info',
  CHECK_IN_EXPIRED: 'bad',
  NO_SHOW_REVIEW: 'bad',
  READY: 'live',
  RESULT_PENDING: 'live',
  DISPUTED: 'bad',
  FORFEITED: 'neutral',
  // disputes
  OPEN: 'bad',
  ASSIGNED: 'info',
  INVESTIGATING: 'live',
  RESOLVED: 'good',
};

const LIVE = new Set(['IN_PROGRESS', 'READY', 'RESULT_PENDING', 'INVESTIGATING']);

export function StatusPill({ status, label }: { status: string; label?: string }) {
  const tone = toneOf[status] ?? 'neutral';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[13px] font-semibold whitespace-nowrap ${tones[tone]}`}
    >
      {LIVE.has(status) && <span className="live-dot size-1.5 rounded-full bg-amber" aria-hidden />}
      {label ?? humanize(status)}
    </span>
  );
}

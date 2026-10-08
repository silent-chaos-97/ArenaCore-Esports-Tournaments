export const DOMAIN_EVENTS_QUEUE = 'domain-events';
export const EMAIL_QUEUE = 'notifications-email';

export const RETRY_POLICY = {
  attempts: 6,
  backoff: { type: 'exponential', delay: 2_000 },
} as const;

import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { ApiEnv } from '@arenacore/shared';
import { Redis } from 'ioredis';
import { filter, map, Observable, Subject } from 'rxjs';
import { API_ENV } from '../../config/config.module.js';
import { REDIS } from '../../infra/redis.module.js';
import type { Notification } from '../../generated/prisma/client.js';
import type { DomainEventEnvelope } from '../notifications/notifications.service.js';
import { toDto } from '../notifications/notifications.service.js';

export const EVENTS_CHANNEL = 'arenacore:events';
export const NOTIFICATIONS_CHANNEL = 'arenacore:notifications';

/** Event types spectators care about; anything else stays private. */
export const PUBLIC_EVENT_TYPES = new Set([
  'TournamentStarted',
  'TournamentCompleted',
  'MatchReady',
  'MatchRescheduled',
  'CheckInOpened',
  'OpponentCheckedIn',
  'ResultReported',
  'MatchCompleted',
  'TeamAdvanced',
  'TeamEliminated',
  'DisputeOpened',
  'DisputeResolved',
]);

export interface LiveEvent {
  type: string;
  tournamentId: string | null;
  matchId: string | null;
  at: string;
}

interface UserMessage {
  userId: string;
  notification: ReturnType<typeof toDto>;
}

/**
 * Cross-process fan-out over Redis pub/sub. The worker publishes; every API instance holds one
 * subscriber connection and multiplexes it to SSE clients in memory.
 */
@Injectable()
export class RealtimeService implements OnModuleDestroy {
  private readonly logger = new Logger(RealtimeService.name);
  private subscriber: Redis | null = null;
  private readonly events$ = new Subject<LiveEvent>();
  private readonly notifications$ = new Subject<UserMessage>();

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  // ── publishing (worker side) ──

  async publishEvent(event: DomainEventEnvelope): Promise<void> {
    if (!PUBLIC_EVENT_TYPES.has(event.type)) return;
    const live: LiveEvent = {
      type: event.type,
      tournamentId:
        typeof event.payload.tournamentId === 'string' ? event.payload.tournamentId : null,
      matchId: typeof event.payload.matchId === 'string' ? event.payload.matchId : null,
      at: new Date().toISOString(),
    };
    await this.redis.publish(EVENTS_CHANNEL, JSON.stringify(live));
  }

  async publishNotification(notification: Notification): Promise<void> {
    const message: UserMessage = { userId: notification.userId, notification: toDto(notification) };
    await this.redis.publish(NOTIFICATIONS_CHANNEL, JSON.stringify(message));
  }

  // ── subscribing (API side) ──

  tournament$(tournamentId: string): Observable<LiveEvent> {
    this.ensureSubscribed();
    return this.events$.pipe(filter((e) => e.tournamentId === tournamentId));
  }

  /** Every public event (used for cache invalidation). */
  all$(): Observable<LiveEvent> {
    this.ensureSubscribed();
    return this.events$.asObservable();
  }

  user$(userId: string): Observable<UserMessage['notification']> {
    this.ensureSubscribed();
    return this.notifications$.pipe(
      filter((m) => m.userId === userId),
      map((m) => m.notification),
    );
  }

  private ensureSubscribed(): void {
    if (this.subscriber) return;
    this.subscriber = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    void this.subscriber.subscribe(EVENTS_CHANNEL, NOTIFICATIONS_CHANNEL);
    this.subscriber.on('message', (channel, raw) => {
      try {
        if (channel === EVENTS_CHANNEL) this.events$.next(JSON.parse(raw) as LiveEvent);
        else this.notifications$.next(JSON.parse(raw) as UserMessage);
      } catch (error) {
        this.logger.warn(`Dropped malformed realtime message: ${String(error)}`);
      }
    });
  }

  /** Resolves once the subscriber connection is listening (used by tests and readiness). */
  async ready(): Promise<void> {
    this.ensureSubscribed();
    while (this.subscriber!.status !== 'ready') await new Promise((r) => setTimeout(r, 20));
    await new Promise((r) => setTimeout(r, 50));
  }

  async onModuleDestroy(): Promise<void> {
    this.events$.complete();
    this.notifications$.complete();
    await this.subscriber?.quit().catch(() => undefined);
  }
}

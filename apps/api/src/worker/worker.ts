import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import type { ApiEnv } from '@arenacore/shared';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { createServer } from 'node:http';
import { API_ENV } from '../config/config.module.js';
import { MetricsService } from '../modules/metrics/metrics.module.js';
import { OutboxRelay } from '../modules/events/outbox-relay.js';
import { SchedulerService } from '../modules/events/scheduler.service.js';
import {
  NotificationsService,
  type DomainEventEnvelope,
} from '../modules/notifications/notifications.service.js';
import { RealtimeService } from '../modules/realtime/realtime.service.js';
import { DOMAIN_EVENTS_QUEUE, EMAIL_QUEUE, RETRY_POLICY } from './queues.js';

/**
 * Background runtime: outbox relay → BullMQ → notification fan-out → email delivery,
 * plus the periodic scheduler. Runs in its own process (src/worker.ts) and scales horizontally.
 */
@Injectable()
export class WorkerRuntime implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Worker');
  private readonly connection: Redis;
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly closers: (() => Promise<unknown>)[] = [];
  private stopping = false;

  constructor(
    @Inject(API_ENV) env: ApiEnv,
    private readonly relay: OutboxRelay,
    private readonly scheduler: SchedulerService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly metrics: MetricsService,
  ) {
    this.connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  }

  onApplicationBootstrap(): void {
    const events = new Queue<DomainEventEnvelope>(DOMAIN_EVENTS_QUEUE, {
      connection: this.connection,
    });
    const emails = new Queue<{ deliveryId: string }>(EMAIL_QUEUE, { connection: this.connection });

    // Live updates go straight to Redis pub/sub so spectators see changes within the relay interval.
    this.relay.addSink((event) => this.realtime.publishEvent(event));
    this.notifications.onCreated((notification) => this.realtime.publishNotification(notification));

    // jobId = event id: a re-relayed event is ignored by BullMQ instead of processed twice.
    this.relay.addSink(async (event) => {
      await events.add(event.type, event, {
        jobId: event.id,
        ...RETRY_POLICY,
        removeOnComplete: 1000,
        removeOnFail: 5000,
      });
    });

    const eventWorker = new Worker<DomainEventEnvelope>(
      DOMAIN_EVENTS_QUEUE,
      async (job) => {
        const { emailDeliveryIds } = await this.notifications.dispatch(job.data);
        for (const deliveryId of emailDeliveryIds) {
          await emails.add(
            'email',
            { deliveryId },
            { jobId: deliveryId, ...RETRY_POLICY, removeOnComplete: 1000 },
          );
        }
      },
      { connection: this.connection, concurrency: 8 },
    );
    const emailWorker = new Worker<{ deliveryId: string }>(
      EMAIL_QUEUE,
      async (job) => this.notifications.deliverEmail(job.data.deliveryId),
      { connection: this.connection, concurrency: 4 },
    );
    for (const w of [eventWorker, emailWorker]) {
      w.on('failed', (job, err) =>
        this.logger.warn(`${w.name} job ${job?.id} failed: ${err.message}`),
      );
    }
    this.closers.push(
      () => eventWorker.close(),
      () => emailWorker.close(),
      () => events.close(),
      () => emails.close(),
    );

    for (const queue of [events, emails]) {
      this.metrics.gauge(
        `queue_depth_${queue.name.replaceAll('-', '_')}`,
        `Jobs in the ${queue.name} queue by state`,
        async () =>
          (await queue.getJobCounts('waiting', 'active', 'delayed', 'failed')) as Record<
            string,
            number
          >,
        'state',
      );
    }
    this.serveMetrics();

    this.loop('outbox-relay', 500, async () => {
      while ((await this.relay.relayOnce()) > 0 && !this.stopping);
    });
    this.loop('scheduler', 30_000, async () => {
      const result = await this.scheduler.tick();
      if (result.opened || result.expired || result.startingSoon)
        this.logger.log(`scheduler ${JSON.stringify(result)}`);
    });
    this.logger.log('Worker started');
  }

  /** Prometheus scrape endpoint for the worker process. */
  private serveMetrics(): void {
    const server = createServer((req, res) => {
      if (req.url !== '/metrics') {
        res.writeHead(404).end();
        return;
      }
      void this.metrics.registry.metrics().then((body) => {
        res.writeHead(200, { 'content-type': this.metrics.registry.contentType }).end(body);
      });
    });
    server.listen(Number(process.env.WORKER_METRICS_PORT ?? 9464));
    this.closers.push(() => new Promise((resolve) => server.close(resolve)));
  }

  private loop(name: string, everyMs: number, fn: () => Promise<void>): void {
    let running = false;
    const timer = setInterval(() => {
      if (running || this.stopping) return;
      running = true;
      fn()
        .catch((error: unknown) => this.logger.error(`${name} failed: ${String(error)}`))
        .finally(() => {
          running = false;
        });
    }, everyMs);
    this.timers.push(timer);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    this.timers.forEach(clearInterval);
    for (const close of this.closers) await close().catch(() => undefined);
    await this.connection.quit().catch(() => undefined);
  }
}

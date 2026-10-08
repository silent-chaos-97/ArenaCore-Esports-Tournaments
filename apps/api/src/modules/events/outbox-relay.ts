import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { MetricsService } from '../metrics/metrics.module.js';
import type { DomainEventEnvelope } from '../notifications/notifications.service.js';

export type EventSink = (event: DomainEventEnvelope) => Promise<void>;

/**
 * Moves committed outbox rows to downstream sinks (queues, realtime). Rows are claimed with
 * FOR UPDATE SKIP LOCKED so several relays can run concurrently without double-publishing.
 * Delivery is at-least-once; consumers are idempotent (job ids / notification dedupe keys).
 */
@Injectable()
export class OutboxRelay {
  private readonly logger = new Logger(OutboxRelay.name);
  private readonly sinks: EventSink[] = [];

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly metrics?: MetricsService,
  ) {
    this.metrics?.gauge('outbox_backlog', 'Domain events committed but not yet relayed', () =>
      this.backlog(),
    );
  }

  addSink(sink: EventSink): void {
    this.sinks.push(sink);
  }

  async relayOnce(batchSize = 100): Promise<number> {
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM outbox_events
          WHERE "processedAt" IS NULL AND attempts < 10
          ORDER BY "createdAt"
          LIMIT ${batchSize}
          FOR UPDATE SKIP LOCKED`;
        let relayed = 0;
        for (const { id } of rows) {
          const event = await tx.outboxEvent.findUniqueOrThrow({ where: { id } });
          const envelope: DomainEventEnvelope = {
            id: event.id,
            type: event.type,
            organizationId: event.organizationId,
            payload: event.payload as Record<string, unknown>,
          };
          try {
            for (const sink of this.sinks) await sink(envelope);
            await tx.outboxEvent.update({
              where: { id },
              data: { processedAt: new Date(), attempts: { increment: 1 } },
            });
            relayed += 1;
            this.metrics?.relayLag.observe((Date.now() - event.createdAt.getTime()) / 1000);
          } catch (error) {
            this.logger.warn(`Relay of ${event.type} ${id} failed: ${String(error)}`);
            await tx.outboxEvent.update({
              where: { id },
              data: { attempts: { increment: 1 }, lastError: String(error).slice(0, 500) },
            });
          }
        }
        return relayed;
      },
      { timeout: 30_000 },
    );
  }

  async backlog(): Promise<number> {
    return this.prisma.outboxEvent.count({ where: { processedAt: null } });
  }
}

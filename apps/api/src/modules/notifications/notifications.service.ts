import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { ListNotificationsQuery, NotificationDto, Page } from '@arenacore/shared';
import { Prisma, type Notification } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { MetricsService } from '../metrics/metrics.module.js';
import { DiscordChannel, EmailChannel } from './channels.js';
import { RecipientResolver } from './recipients.js';
import { planNotifications } from './templates.js';

export interface DomainEventEnvelope {
  id: string;
  type: string;
  organizationId: string | null;
  payload: Record<string, unknown>;
}

export interface DispatchResult {
  created: Notification[];
  emailDeliveryIds: string[];
}

/** Hook used by the realtime gateway to push new notifications to connected users. */
export type NotificationListener = (notification: Notification) => Promise<void> | void;

@Injectable()
export class NotificationsService {
  private readonly listeners: NotificationListener[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly recipients: RecipientResolver,
    private readonly email: EmailChannel,
    private readonly discord: DiscordChannel,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  onCreated(listener: NotificationListener): void {
    this.listeners.push(listener);
  }

  /**
   * Fans an event out to in-app notifications. Safe to call repeatedly for the same event:
   * (userId, dedupeKey) is unique, so relay retries never notify twice.
   */
  async dispatch(event: DomainEventEnvelope): Promise<DispatchResult> {
    const created: Notification[] = [];
    const emailDeliveryIds: string[] = [];
    for (const [index, plan] of planNotifications(event).entries()) {
      const userIds = await this.recipients.resolve(plan.audiences);
      for (const userId of userIds) {
        const dedupeKey = `${event.id}:${index}`;
        try {
          const notification = await this.prisma.notification.create({
            data: {
              userId,
              type: plan.type,
              title: plan.title,
              body: plan.body,
              data: plan.data as Prisma.InputJsonValue,
              dedupeKey,
              deliveries: {
                create: [
                  { channel: 'IN_APP', status: 'SENT', sentAt: new Date(), attempts: 1 },
                  ...(plan.email ? [{ channel: 'EMAIL' as const }] : []),
                ],
              },
            },
            include: { deliveries: true },
          });
          created.push(notification);
          emailDeliveryIds.push(
            ...notification.deliveries.filter((d) => d.channel === 'EMAIL').map((d) => d.id),
          );
          for (const listener of this.listeners) await listener(notification);
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
            continue;
          throw error;
        }
      }
    }
    if (
      this.discord.enabled &&
      (event.type === 'DisputeOpened' || event.type === 'TournamentCompleted')
    ) {
      await this.discord.send(`**${event.type}** ${JSON.stringify(event.payload)}`);
    }
    return { created, emailDeliveryIds };
  }

  /** Sends one pending email delivery; throws on failure so the queue retries with backoff. */
  async deliverEmail(deliveryId: string): Promise<'SENT' | 'SKIPPED'> {
    const delivery = await this.prisma.notificationDelivery.findUnique({
      where: { id: deliveryId },
      include: { notification: { include: { user: true } } },
    });
    if (!delivery || delivery.status === 'SENT') return 'SKIPPED';
    try {
      await this.email.send({
        to: delivery.notification.user.email,
        subject: `[ArenaCore] ${delivery.notification.title}`,
        text: `${delivery.notification.body}\n\n— ArenaCore`,
      });
      await this.prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: { status: 'SENT', sentAt: new Date(), attempts: { increment: 1 }, lastError: null },
      });
      this.metrics?.notificationDeliveries.inc({ channel: 'EMAIL', status: 'SENT' });
      return 'SENT';
    } catch (error) {
      await this.prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'FAILED',
          attempts: { increment: 1 },
          lastError: String(error).slice(0, 500),
        },
      });
      this.metrics?.notificationDeliveries.inc({ channel: 'EMAIL', status: 'FAILED' });
      throw error;
    }
  }

  // ───────────────────────────── Inbox API ─────────────────────────────

  async list(
    userId: string,
    query: ListNotificationsQuery,
  ): Promise<Page<NotificationDto> & { unread: number }> {
    const rows = await this.prisma.notification.findMany({
      where: { userId, ...(query.unreadOnly ? { readAt: null } : {}) },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(toDto),
      nextCursor: rows.length > query.limit ? page[page.length - 1]!.id : null,
      unread: await this.prisma.notification.count({ where: { userId, readAt: null } }),
    };
  }

  async markRead(userId: string, id: string): Promise<NotificationDto> {
    await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    const row = await this.prisma.notification.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException('Notification not found');
    return toDto(row);
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const res = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: res.count };
  }
}

export function toDto(n: Notification): NotificationDto {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    data: n.data as Record<string, unknown>,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}

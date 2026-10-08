import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type { Tx } from '../../infra/prisma/prisma.service.js';

export interface DomainEvent {
  type: string;
  aggregateType: string;
  aggregateId: string;
  organizationId?: string | null;
  payload: Record<string, unknown>;
}

/** Transactional outbox writer: events commit atomically with the state change that caused them. */
@Injectable()
export class OutboxService {
  async emit(tx: Tx, event: DomainEvent): Promise<void> {
    await tx.outboxEvent.create({
      data: {
        type: event.type,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        organizationId: event.organizationId ?? null,
        payload: JSON.parse(JSON.stringify(event.payload)) as Prisma.InputJsonValue,
      },
    });
  }
}

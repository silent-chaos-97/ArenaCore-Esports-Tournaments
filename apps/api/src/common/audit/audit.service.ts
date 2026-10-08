import { Injectable } from '@nestjs/common';
import { currentRequestId } from '../context/request-context.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { Tx } from '../../infra/prisma/prisma.service.js';

export interface AuditEntry {
  organizationId: string | null;
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
}

/** Records administrative actions. Always call inside the transaction that performs the change. */
@Injectable()
export class AuditService {
  async record(tx: Tx, entry: AuditEntry): Promise<void> {
    await tx.auditLog.create({
      data: {
        organizationId: entry.organizationId,
        actorId: entry.actorId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        oldValue: toJson(entry.oldValue),
        newValue: toJson(entry.newValue),
        reason: entry.reason ?? null,
        requestId: currentRequestId() ?? null,
      },
    });
  }
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

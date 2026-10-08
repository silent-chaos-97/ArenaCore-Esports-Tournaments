import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit/audit.service.js';
import { OutboxService } from './outbox/outbox.service.js';
import { AccessService } from './tenant/access.service.js';
import { TenantGuard } from './tenant/tenant.guard.js';

/** Cross-cutting services every domain module depends on. */
@Global()
@Module({
  providers: [AuditService, OutboxService, AccessService, TenantGuard],
  exports: [AuditService, OutboxService, AccessService, TenantGuard],
})
export class PlatformModule {}

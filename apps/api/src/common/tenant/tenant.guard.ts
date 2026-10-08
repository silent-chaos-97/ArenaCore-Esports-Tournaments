import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createParamDecorator } from '@nestjs/common';
import { ORG_ROLES, type OrgRole } from '@arenacore/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { AccessService } from './access.service.js';
import type { TenantContext } from './tenant.types.js';

const ROLES_KEY = 'arenacore:roles';

/** Allowed organization roles for an org-scoped route (`/orgs/:orgId/...`). Use with TenantGuard. */
export const Roles = (...roles: OrgRole[]) => SetMetadata(ROLES_KEY, roles);

export const Tenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantContext => {
    const tenant = ctx.switchToHttp().getRequest<Request>().tenant;
    if (!tenant) throw new Error('TenantGuard did not run for this route');
    return tenant;
  },
);

const orgIdSchema = z.uuid();

/** Resolves `:orgId`, verifies membership + role (and MFA for privileged roles), sets `req.tenant`. */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const roles = this.reflector.getAllAndOverride<OrgRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? [...ORG_ROLES];
    const orgId = req.params.orgId;
    if (typeof orgId !== 'string' || !orgIdSchema.safeParse(orgId).success) {
      throw new NotFoundException('Organization not found');
    }
    req.tenant = await this.access.resolveMembership(req.user!, orgId, roles);
    return true;
  }
}

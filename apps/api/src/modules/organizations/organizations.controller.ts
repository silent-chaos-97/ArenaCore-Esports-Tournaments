import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  acceptInviteSchema,
  auditQuerySchema,
  changeMemberRoleSchema,
  createOrganizationSchema,
  inviteStaffSchema,
  updateOrganizationSchema,
  type AcceptInviteInput,
  type AuditQuery,
  type ChangeMemberRoleInput,
  type CreateOrganizationInput,
  type InviteStaffInput,
  type UpdateOrganizationInput,
} from '@arenacore/shared';
import type { AuthUser } from '../../common/auth/auth.types.js';
import { CurrentUser } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { Roles, Tenant, TenantGuard } from '../../common/tenant/tenant.guard.js';
import type { TenantContext } from '../../common/tenant/tenant.types.js';
import { OrganizationsService } from './organizations.service.js';

@Controller('orgs')
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createOrganizationSchema)) body: CreateOrganizationInput,
  ) {
    return this.orgs.create(user.id, body);
  }

  @Get()
  mine(@CurrentUser() user: AuthUser) {
    return this.orgs.listForUser(user.id);
  }

  @Get(':orgId')
  @UseGuards(TenantGuard)
  get(@Tenant() tenant: TenantContext) {
    return this.orgs.get(tenant);
  }

  @Patch(':orgId')
  @UseGuards(TenantGuard)
  @Roles('OWNER', 'ADMIN')
  rename(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(updateOrganizationSchema)) body: UpdateOrganizationInput,
  ) {
    return this.orgs.rename(tenant, body.name);
  }

  @Get(':orgId/members')
  @UseGuards(TenantGuard)
  members(@Tenant() tenant: TenantContext) {
    return this.orgs.members(tenant);
  }

  @Patch(':orgId/members/:memberId')
  @UseGuards(TenantGuard)
  @Roles('OWNER')
  @HttpCode(204)
  changeRole(
    @Tenant() tenant: TenantContext,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body(new ZodValidationPipe(changeMemberRoleSchema)) body: ChangeMemberRoleInput,
  ) {
    return this.orgs.changeRole(tenant, memberId, body.role);
  }

  @Delete(':orgId/members/:memberId')
  @UseGuards(TenantGuard)
  @Roles('OWNER', 'ADMIN')
  @HttpCode(204)
  removeMember(
    @Tenant() tenant: TenantContext,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ) {
    return this.orgs.removeMember(tenant, memberId);
  }

  @Post(':orgId/invites')
  @UseGuards(TenantGuard)
  @Roles('OWNER', 'ADMIN')
  invite(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(inviteStaffSchema)) body: InviteStaffInput,
  ) {
    return this.orgs.invite(tenant, body);
  }

  @Get(':orgId/invites')
  @UseGuards(TenantGuard)
  @Roles('OWNER', 'ADMIN')
  invites(@Tenant() tenant: TenantContext) {
    return this.orgs.pendingInvites(tenant);
  }

  @Delete(':orgId/invites/:inviteId')
  @UseGuards(TenantGuard)
  @Roles('OWNER', 'ADMIN')
  @HttpCode(204)
  revokeInvite(
    @Tenant() tenant: TenantContext,
    @Param('inviteId', ParseUUIDPipe) inviteId: string,
  ) {
    return this.orgs.revokeInvite(tenant, inviteId);
  }

  @Get(':orgId/audit')
  @UseGuards(TenantGuard)
  @Roles('OWNER', 'ADMIN')
  audit(
    @Tenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(auditQuerySchema)) query: AuditQuery,
  ) {
    return this.orgs.auditLog(tenant, query);
  }
}

@Controller('invites')
export class InvitesController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Post('accept')
  @HttpCode(200)
  accept(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(acceptInviteSchema)) body: AcceptInviteInput,
  ) {
    return this.orgs.acceptInvite(user.id, body.token);
  }
}

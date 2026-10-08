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
  assignStaffSchema,
  cancelTournamentSchema,
  cloneTournamentSchema,
  createTournamentSchema,
  listTournamentsQuerySchema,
  updateTournamentSchema,
  type AssignStaffInput,
  type CancelTournamentInput,
  type CloneTournamentInput,
  type CreateTournamentInput,
  type TournamentStatus,
  type UpdateTournamentInput,
} from '@arenacore/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { Roles, Tenant, TenantGuard } from '../../common/tenant/tenant.guard.js';
import type { TenantContext } from '../../common/tenant/tenant.types.js';
import { TournamentsService } from './tournaments.service.js';

@Controller('orgs/:orgId/tournaments')
@UseGuards(TenantGuard)
export class TournamentsController {
  constructor(private readonly tournaments: TournamentsService) {}

  @Post()
  @Roles('OWNER', 'ADMIN')
  create(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createTournamentSchema)) body: CreateTournamentInput,
  ) {
    return this.tournaments.create(tenant, body);
  }

  @Get()
  list(
    @Tenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listTournamentsQuerySchema)) query: { status?: TournamentStatus },
  ) {
    return this.tournaments.list(tenant, query.status);
  }

  @Get(':tournamentId')
  get(@Tenant() tenant: TenantContext, @Param('tournamentId', ParseUUIDPipe) id: string) {
    return this.tournaments.get(tenant, id);
  }

  @Patch(':tournamentId')
  @Roles('OWNER', 'ADMIN')
  update(
    @Tenant() tenant: TenantContext,
    @Param('tournamentId', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateTournamentSchema)) body: UpdateTournamentInput,
  ) {
    return this.tournaments.update(tenant, id, body);
  }

  @Post(':tournamentId/publish')
  @Roles('OWNER', 'ADMIN')
  @HttpCode(200)
  publish(@Tenant() tenant: TenantContext, @Param('tournamentId', ParseUUIDPipe) id: string) {
    return this.tournaments.publish(tenant, id);
  }

  @Post(':tournamentId/unpublish')
  @Roles('OWNER', 'ADMIN')
  @HttpCode(200)
  unpublish(@Tenant() tenant: TenantContext, @Param('tournamentId', ParseUUIDPipe) id: string) {
    return this.tournaments.unpublish(tenant, id);
  }

  @Post(':tournamentId/cancel')
  @Roles('OWNER', 'ADMIN')
  @HttpCode(200)
  cancel(
    @Tenant() tenant: TenantContext,
    @Param('tournamentId', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(cancelTournamentSchema)) body: CancelTournamentInput,
  ) {
    return this.tournaments.cancel(tenant, id, body.reason);
  }

  @Post(':tournamentId/clone')
  @Roles('OWNER', 'ADMIN')
  clone(
    @Tenant() tenant: TenantContext,
    @Param('tournamentId', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(cloneTournamentSchema)) body: CloneTournamentInput,
  ) {
    return this.tournaments.clone(tenant, id, body.name);
  }

  @Get(':tournamentId/staff')
  staff(@Tenant() tenant: TenantContext, @Param('tournamentId', ParseUUIDPipe) id: string) {
    return this.tournaments.staff(tenant, id);
  }

  @Post(':tournamentId/staff')
  @Roles('OWNER', 'ADMIN')
  @HttpCode(204)
  assignStaff(
    @Tenant() tenant: TenantContext,
    @Param('tournamentId', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(assignStaffSchema)) body: AssignStaffInput,
  ) {
    return this.tournaments.assignStaff(tenant, id, body);
  }

  @Delete(':tournamentId/staff/:userId')
  @Roles('OWNER', 'ADMIN')
  @HttpCode(204)
  removeStaff(
    @Tenant() tenant: TenantContext,
    @Param('tournamentId', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.tournaments.removeStaff(tenant, id, userId);
  }
}

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  listRegistrationsQuerySchema,
  rejectRegistrationSchema,
  submitRegistrationSchema,
  updateRosterSchema,
  type RegistrationStatus,
  type RejectRegistrationInput,
  type SubmitRegistrationInput,
  type UpdateRosterInput,
} from '@arenacore/shared';
import type { AuthUser } from '../../common/auth/auth.types.js';
import { CurrentUser } from '../../common/auth/decorators.js';
import { Idempotent } from '../../common/idempotency/idempotency.interceptor.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { TenantGuard } from '../../common/tenant/tenant.guard.js';
import { RegistrationsService } from './registrations.service.js';

@Controller()
export class RegistrationsController {
  constructor(private readonly registrations: RegistrationsService) {}

  @Post('tournaments/:tournamentId/registrations')
  @Idempotent('registration.submit')
  submit(
    @CurrentUser() user: AuthUser,
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Body(new ZodValidationPipe(submitRegistrationSchema)) body: SubmitRegistrationInput,
  ) {
    return this.registrations.submit(user.id, tournamentId, body);
  }

  @Get('registrations/mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.registrations.mine(user.id);
  }

  @Get('registrations/:registrationId')
  get(@CurrentUser() user: AuthUser, @Param('registrationId', ParseUUIDPipe) id: string) {
    return this.registrations.getForTeamMember(user.id, id);
  }

  @Put('registrations/:registrationId/roster')
  updateRoster(
    @CurrentUser() user: AuthUser,
    @Param('registrationId', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateRosterSchema)) body: UpdateRosterInput,
  ) {
    return this.registrations.updateRoster(user.id, id, body);
  }

  @Post('registrations/:registrationId/withdraw')
  @HttpCode(200)
  withdraw(@CurrentUser() user: AuthUser, @Param('registrationId', ParseUUIDPipe) id: string) {
    return this.registrations.withdraw(user.id, id);
  }
}

@Controller('orgs/:orgId/tournaments/:tournamentId/registrations')
@UseGuards(TenantGuard)
export class OrganizerRegistrationsController {
  constructor(private readonly registrations: RegistrationsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Query(new ZodValidationPipe(listRegistrationsQuerySchema))
    query: { status?: RegistrationStatus },
  ) {
    return this.registrations.list(user, orgId, tournamentId, query.status);
  }

  @Post(':registrationId/review')
  @HttpCode(200)
  review(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Param('registrationId', ParseUUIDPipe) id: string,
  ) {
    return this.registrations.startReview(user, orgId, tournamentId, id);
  }

  @Post(':registrationId/approve')
  @HttpCode(200)
  approve(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Param('registrationId', ParseUUIDPipe) id: string,
  ) {
    return this.registrations.approve(user, orgId, tournamentId, id);
  }

  @Post(':registrationId/reject')
  @HttpCode(200)
  reject(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Param('registrationId', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(rejectRegistrationSchema)) body: RejectRegistrationInput,
  ) {
    return this.registrations.reject(user, orgId, tournamentId, id, body.reason);
  }
}

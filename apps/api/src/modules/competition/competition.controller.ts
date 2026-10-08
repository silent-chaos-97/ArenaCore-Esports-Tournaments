import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  randomizeSeedingSchema,
  scheduleMatchSchema,
  setSeedingSchema,
  tournamentCheckInSchema,
  type RandomizeSeedingInput,
  type ScheduleMatchInput,
  type SetSeedingInput,
  type TournamentCheckInInput,
} from '@arenacore/shared';
import type { AuthUser } from '../../common/auth/auth.types.js';
import { CurrentUser } from '../../common/auth/decorators.js';
import { Idempotent } from '../../common/idempotency/idempotency.interceptor.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { TenantGuard } from '../../common/tenant/tenant.guard.js';
import { CompetitionService } from './competition.service.js';

@Controller('tournaments/:tournamentId')
export class CheckInController {
  constructor(private readonly competition: CompetitionService) {}

  @Post('check-in')
  @HttpCode(200)
  @Idempotent('tournament.check-in')
  checkIn(
    @CurrentUser() user: AuthUser,
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Body(new ZodValidationPipe(tournamentCheckInSchema)) body: TournamentCheckInInput,
  ) {
    return this.competition.checkIn(user.id, tournamentId, body.teamId);
  }
}

@Controller('orgs/:orgId')
@UseGuards(TenantGuard)
export class CompetitionController {
  constructor(private readonly competition: CompetitionService) {}

  @Post('tournaments/:tournamentId/registrations/:registrationId/check-in')
  @HttpCode(200)
  adminCheckIn(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Param('registrationId', ParseUUIDPipe) registrationId: string,
  ) {
    return this.competition.adminCheckIn(user, orgId, tournamentId, registrationId);
  }

  @Put('tournaments/:tournamentId/seeding')
  setSeeding(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Body(new ZodValidationPipe(setSeedingSchema)) body: SetSeedingInput,
  ) {
    return this.competition.setSeeding(user, orgId, tournamentId, body.order);
  }

  @Post('tournaments/:tournamentId/seeding/randomize')
  @HttpCode(200)
  randomize(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Body(new ZodValidationPipe(randomizeSeedingSchema)) body: RandomizeSeedingInput,
  ) {
    return this.competition.randomizeSeeding(user, orgId, tournamentId, body.seed);
  }

  @Post('tournaments/:tournamentId/start')
  @HttpCode(200)
  start(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
  ) {
    return this.competition.start(user, orgId, tournamentId);
  }

  @Get('tournaments/:tournamentId/bracket')
  bracket(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
  ) {
    return this.competition.bracket(user, orgId, tournamentId);
  }

  @Get('tournaments/:tournamentId/matches')
  matches(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Query('status') status?: string,
  ) {
    return this.competition.matches(user, orgId, tournamentId, status);
  }

  @Patch('matches/:matchId/schedule')
  schedule(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('matchId', ParseUUIDPipe) matchId: string,
    @Body(new ZodValidationPipe(scheduleMatchSchema)) body: ScheduleMatchInput,
  ) {
    return this.competition.scheduleMatch(user, orgId, matchId, body.scheduledAt, body.reason);
  }
}

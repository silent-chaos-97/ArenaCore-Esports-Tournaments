import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import {
  adminResultSchema,
  reportResultSchema,
  setLobbySchema,
  type AdminResultInput,
  type ReportResultInput,
  type SetLobbyInput,
} from '@arenacore/shared';
import type { Request } from 'express';
import type { AuthUser } from '../../common/auth/auth.types.js';
import { CurrentUser, Public } from '../../common/auth/decorators.js';
import { Idempotent } from '../../common/idempotency/idempotency.interceptor.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.js';
import { TenantGuard } from '../../common/tenant/tenant.guard.js';
import { MetricsService } from '../metrics/metrics.module.js';
import { MatchesService } from './matches.service.js';
import { ResultsService } from './results.service.js';

@Controller('matches')
export class MatchesController {
  constructor(
    private readonly matches: MatchesService,
    private readonly results: ResultsService,
  ) {}

  @Get('mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.matches.mine(user.id);
  }

  @Public()
  @Get(':matchId')
  get(@Param('matchId', ParseUUIDPipe) matchId: string) {
    return this.matches.publicSummary(matchId);
  }

  @Get(':matchId/detail')
  detail(@CurrentUser() user: AuthUser, @Param('matchId', ParseUUIDPipe) matchId: string) {
    return this.matches.detail(user, matchId);
  }

  @Post(':matchId/check-in')
  @HttpCode(200)
  @Idempotent('match.check-in')
  checkIn(@CurrentUser() user: AuthUser, @Param('matchId', ParseUUIDPipe) matchId: string) {
    return this.matches.checkIn(user.id, matchId);
  }

  @Post(':matchId/results')
  @HttpCode(200)
  @Idempotent('match.result')
  report(
    @CurrentUser() user: AuthUser,
    @Param('matchId', ParseUUIDPipe) matchId: string,
    @Body(new ZodValidationPipe(reportResultSchema)) body: ReportResultInput,
  ) {
    return this.results.report(user.id, matchId, body);
  }
}

@Controller('orgs/:orgId/matches/:matchId')
@UseGuards(TenantGuard)
export class OrganizerMatchesController {
  constructor(
    private readonly matches: MatchesService,
    private readonly results: ResultsService,
  ) {}

  @Post('result')
  @HttpCode(200)
  @Idempotent('match.admin-result')
  result(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('matchId', ParseUUIDPipe) matchId: string,
    @Body(new ZodValidationPipe(adminResultSchema)) body: AdminResultInput,
  ) {
    return this.results.adminResult(user, orgId, matchId, body);
  }

  @Patch('lobby')
  setLobby(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('matchId', ParseUUIDPipe) matchId: string,
    @Body(new ZodValidationPipe(setLobbySchema)) body: SetLobbyInput,
  ) {
    return this.matches.setLobby(user, orgId, matchId, body);
  }

  @Post('lobby')
  @HttpCode(200)
  createLobby(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('matchId', ParseUUIDPipe) matchId: string,
  ) {
    return this.matches.createLobby(user, orgId, matchId);
  }
}

@Controller('webhooks/games')
export class GameWebhooksController {
  constructor(
    private readonly results: ResultsService,
    private readonly metrics: MetricsService,
  ) {}

  @Public()
  @RateLimit({ limit: 600, windowSeconds: 60 })
  @Post(':provider/match-result')
  @HttpCode(202)
  ingest(
    @Param('provider') provider: string,
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-arenacore-signature') signature: string | undefined,
    @Body() body: unknown,
  ) {
    return this.results.ingestWebhook(provider, req.rawBody, signature, body).then(
      (result) => {
        this.metrics.webhookRequests.inc({ provider, outcome: result.status });
        return result;
      },
      (error: unknown) => {
        this.metrics.webhookRequests.inc({ provider, outcome: 'failed' });
        throw error;
      },
    );
  }
}

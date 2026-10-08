import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  addEvidenceSchema,
  assignDisputeSchema,
  evidenceUploadRequestSchema,
  listDisputesQuerySchema,
  openDisputeSchema,
  resolveDisputeSchema,
  type AddEvidenceInput,
  type AssignDisputeInput,
  type EvidenceUploadRequest,
  type ListDisputesQuery,
  type OpenDisputeInput,
  type ResolveDisputeInput,
} from '@arenacore/shared';
import type { AuthUser } from '../../common/auth/auth.types.js';
import { CurrentUser } from '../../common/auth/decorators.js';
import { Idempotent } from '../../common/idempotency/idempotency.interceptor.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { TenantGuard } from '../../common/tenant/tenant.guard.js';
import { DisputesService } from './disputes.service.js';

@Controller()
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Post('matches/:matchId/disputes')
  @Idempotent('dispute.open')
  open(
    @CurrentUser() user: AuthUser,
    @Param('matchId', ParseUUIDPipe) matchId: string,
    @Body(new ZodValidationPipe(openDisputeSchema)) body: OpenDisputeInput,
  ) {
    return this.disputes.open(user.id, matchId, body);
  }

  @Get('disputes/mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.disputes.mine(user.id);
  }

  @Get('disputes/:disputeId')
  get(@CurrentUser() user: AuthUser, @Param('disputeId', ParseUUIDPipe) id: string) {
    return this.disputes.get(user, id);
  }

  @Post('disputes/:disputeId/withdraw')
  @HttpCode(200)
  withdraw(@CurrentUser() user: AuthUser, @Param('disputeId', ParseUUIDPipe) id: string) {
    return this.disputes.withdraw(user.id, id);
  }

  @Post('disputes/:disputeId/evidence/upload-url')
  @HttpCode(200)
  uploadUrl(
    @CurrentUser() user: AuthUser,
    @Param('disputeId', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(evidenceUploadRequestSchema)) body: EvidenceUploadRequest,
  ) {
    return this.disputes.requestUpload(user, id, body);
  }

  @Post('disputes/:disputeId/evidence')
  addEvidence(
    @CurrentUser() user: AuthUser,
    @Param('disputeId', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(addEvidenceSchema)) body: AddEvidenceInput,
  ) {
    return this.disputes.addEvidence(user, id, body);
  }

  @Get('disputes/:disputeId/evidence/:evidenceId/download')
  download(
    @CurrentUser() user: AuthUser,
    @Param('disputeId', ParseUUIDPipe) id: string,
    @Param('evidenceId', ParseUUIDPipe) evidenceId: string,
  ) {
    return this.disputes.downloadUrl(user, id, evidenceId);
  }
}

@Controller('orgs/:orgId/disputes')
@UseGuards(TenantGuard)
export class OrganizerDisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query(new ZodValidationPipe(listDisputesQuerySchema)) query: ListDisputesQuery,
  ) {
    return this.disputes.list(user, orgId, query);
  }

  @Get(':disputeId')
  workspace(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('disputeId', ParseUUIDPipe) id: string,
  ) {
    return this.disputes.workspace(user, orgId, id);
  }

  @Post(':disputeId/assign')
  @HttpCode(200)
  assign(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('disputeId', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(assignDisputeSchema)) body: AssignDisputeInput,
  ) {
    return this.disputes.assign(user, orgId, id, body.refereeUserId);
  }

  @Post(':disputeId/investigate')
  @HttpCode(200)
  investigate(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('disputeId', ParseUUIDPipe) id: string,
  ) {
    return this.disputes.startInvestigation(user, orgId, id);
  }

  @Post(':disputeId/resolve')
  @HttpCode(200)
  @Idempotent('dispute.resolve')
  resolve(
    @CurrentUser() user: AuthUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('disputeId', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(resolveDisputeSchema)) body: ResolveDisputeInput,
  ) {
    return this.disputes.resolve(user, orgId, id, body);
  }
}

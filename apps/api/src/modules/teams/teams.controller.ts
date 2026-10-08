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
} from '@nestjs/common';
import {
  createTeamSchema,
  inviteTeamMemberSchema,
  linkGameAccountSchema,
  updatePlayerSchema,
  updateTeamMemberSchema,
  updateTeamSchema,
  type CreateTeamInput,
  type InviteTeamMemberInput,
  type LinkGameAccountInput,
  type UpdatePlayerInput,
  type UpdateTeamInput,
  type UpdateTeamMemberInput,
} from '@arenacore/shared';
import type { AuthUser } from '../../common/auth/auth.types.js';
import { CurrentUser, Public } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { PlayersService } from './players.service.js';
import { TeamsService } from './teams.service.js';

@Controller()
export class PlayersController {
  constructor(
    private readonly players: PlayersService,
    private readonly teams: TeamsService,
  ) {}

  @Public()
  @Get('games')
  games() {
    return this.players.games();
  }

  @Get('players/me')
  me(@CurrentUser() user: AuthUser) {
    return this.players.profile(user.id);
  }

  @Patch('players/me')
  update(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updatePlayerSchema)) body: UpdatePlayerInput,
  ) {
    return this.players.update(user.id, body);
  }

  @Post('players/me/game-accounts')
  link(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(linkGameAccountSchema)) body: LinkGameAccountInput,
  ) {
    return this.players.linkAccount(user.id, body);
  }

  @Delete('players/me/game-accounts/:accountId')
  @HttpCode(204)
  unlink(@CurrentUser() user: AuthUser, @Param('accountId', ParseUUIDPipe) accountId: string) {
    return this.players.unlinkAccount(user.id, accountId);
  }

  @Get('players/me/team-invites')
  myInvites(@CurrentUser() user: AuthUser) {
    return this.teams.myInvites(user.id);
  }

  @Public()
  @Get('players/:playerId')
  publicProfile(@Param('playerId', ParseUUIDPipe) playerId: string) {
    return this.players.publicProfile(playerId);
  }
}

@Controller('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createTeamSchema)) body: CreateTeamInput,
  ) {
    return this.teams.create(user.id, body);
  }

  @Get('mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.teams.mine(user.id);
  }

  @Public()
  @Get(':teamId')
  get(@Param('teamId', ParseUUIDPipe) teamId: string) {
    return this.teams.get(teamId);
  }

  @Patch(':teamId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Body(new ZodValidationPipe(updateTeamSchema)) body: UpdateTeamInput,
  ) {
    return this.teams.update(user.id, teamId, body);
  }

  @Post(':teamId/invites')
  invite(
    @CurrentUser() user: AuthUser,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Body(new ZodValidationPipe(inviteTeamMemberSchema)) body: InviteTeamMemberInput,
  ) {
    return this.teams.invite(user.id, teamId, body);
  }

  @Get(':teamId/invites')
  invites(@CurrentUser() user: AuthUser, @Param('teamId', ParseUUIDPipe) teamId: string) {
    return this.teams.invitesForTeam(user.id, teamId);
  }

  @Delete(':teamId/invites/:inviteId')
  @HttpCode(204)
  revokeInvite(
    @CurrentUser() user: AuthUser,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Param('inviteId', ParseUUIDPipe) inviteId: string,
  ) {
    return this.teams.revokeInvite(user.id, teamId, inviteId);
  }

  @Patch(':teamId/members/:memberId')
  updateMember(
    @CurrentUser() user: AuthUser,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body(new ZodValidationPipe(updateTeamMemberSchema)) body: UpdateTeamMemberInput,
  ) {
    return this.teams.updateMember(user.id, teamId, memberId, body);
  }

  @Delete(':teamId/members/:memberId')
  @HttpCode(204)
  removeMember(
    @CurrentUser() user: AuthUser,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ) {
    return this.teams.removeMember(user.id, teamId, memberId);
  }
}

@Controller('team-invites')
export class TeamInvitesController {
  constructor(private readonly teams: TeamsService) {}

  @Post(':inviteId/accept')
  @HttpCode(200)
  accept(@CurrentUser() user: AuthUser, @Param('inviteId', ParseUUIDPipe) inviteId: string) {
    return this.teams.respond(user.id, inviteId, true);
  }

  @Post(':inviteId/decline')
  @HttpCode(204)
  async decline(@CurrentUser() user: AuthUser, @Param('inviteId', ParseUUIDPipe) inviteId: string) {
    await this.teams.respond(user.id, inviteId, false);
  }
}

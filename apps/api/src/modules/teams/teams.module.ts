import { Module } from '@nestjs/common';
import { PlayersService } from './players.service.js';
import { PlayersController, TeamInvitesController, TeamsController } from './teams.controller.js';
import { TeamsService } from './teams.service.js';

@Module({
  controllers: [PlayersController, TeamsController, TeamInvitesController],
  providers: [PlayersService, TeamsService],
  exports: [PlayersService, TeamsService],
})
export class TeamsModule {}

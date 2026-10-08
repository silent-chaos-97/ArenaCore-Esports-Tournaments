import { Module } from '@nestjs/common';
import { RegistrationsModule } from '../registrations/registrations.module.js';
import { TeamsModule } from '../teams/teams.module.js';
import { BracketQueryService } from './bracket-query.service.js';
import { BracketStore } from './bracket-store.js';
import { CheckInController, CompetitionController } from './competition.controller.js';
import { CompetitionService } from './competition.service.js';

@Module({
  imports: [TeamsModule, RegistrationsModule],
  controllers: [CheckInController, CompetitionController],
  providers: [CompetitionService, BracketStore, BracketQueryService],
  exports: [BracketStore, BracketQueryService],
})
export class CompetitionModule {}

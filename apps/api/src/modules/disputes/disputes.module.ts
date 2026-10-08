import { Module } from '@nestjs/common';
import { CompetitionModule } from '../competition/competition.module.js';
import { MatchesModule } from '../matches/matches.module.js';
import { DisputesController, OrganizerDisputesController } from './disputes.controller.js';
import { DisputesService } from './disputes.service.js';

@Module({
  imports: [CompetitionModule, MatchesModule],
  controllers: [DisputesController, OrganizerDisputesController],
  providers: [DisputesService],
})
export class DisputesModule {}

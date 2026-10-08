import { Module } from '@nestjs/common';
import { CompetitionModule } from '../competition/competition.module.js';
import { DisputeFactory } from '../disputes/dispute-factory.js';
import {
  GameWebhooksController,
  MatchesController,
  OrganizerMatchesController,
} from './matches.controller.js';
import { MatchesService } from './matches.service.js';
import { GameProviderRegistry } from './providers/game-provider.js';
import { ResultsService } from './results.service.js';

@Module({
  imports: [CompetitionModule],
  controllers: [MatchesController, OrganizerMatchesController, GameWebhooksController],
  providers: [
    MatchesService,
    ResultsService,
    DisputeFactory,
    { provide: GameProviderRegistry, useValue: new GameProviderRegistry() },
  ],
  exports: [MatchesService, ResultsService, DisputeFactory],
})
export class MatchesModule {}

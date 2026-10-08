import { Module } from '@nestjs/common';
import { CompetitionModule } from '../competition/competition.module.js';
import { PublicController } from './public.controller.js';
import { PublicService } from './public.service.js';

@Module({
  imports: [CompetitionModule],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}

import { Module } from '@nestjs/common';
import { TeamsModule } from '../teams/teams.module.js';
import {
  OrganizerRegistrationsController,
  RegistrationsController,
} from './registrations.controller.js';
import { RegistrationsService } from './registrations.service.js';

@Module({
  imports: [TeamsModule],
  controllers: [RegistrationsController, OrganizerRegistrationsController],
  providers: [RegistrationsService],
  exports: [RegistrationsService],
})
export class RegistrationsModule {}

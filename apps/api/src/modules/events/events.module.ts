import { Module } from '@nestjs/common';
import { MatchesModule } from '../matches/matches.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { OutboxRelay } from './outbox-relay.js';
import { SchedulerService } from './scheduler.service.js';

@Module({
  imports: [MatchesModule, NotificationsModule],
  providers: [OutboxRelay, SchedulerService],
  exports: [OutboxRelay, SchedulerService, NotificationsModule],
})
export class EventsModule {}

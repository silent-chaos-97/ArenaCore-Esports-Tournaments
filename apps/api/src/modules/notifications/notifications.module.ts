import { Module } from '@nestjs/common';
import { DiscordChannel, EmailChannel } from './channels.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { RecipientResolver } from './recipients.js';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, RecipientResolver, EmailChannel, DiscordChannel],
  exports: [NotificationsService],
})
export class NotificationsModule {}

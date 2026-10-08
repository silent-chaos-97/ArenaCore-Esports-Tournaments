import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { PlatformModule } from '../common/platform.module.js';
import { ConfigModule } from '../config/config.module.js';
import { PrismaModule } from '../infra/prisma/prisma.module.js';
import { RedisModule } from '../infra/redis.module.js';
import { StorageModule } from '../infra/storage/storage.service.js';
import { EventsModule } from '../modules/events/events.module.js';
import { WorkerRuntime } from './worker.js';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        transport:
          process.env.NODE_ENV === 'development'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
      },
    }),
    PrismaModule,
    RedisModule,
    StorageModule,
    PlatformModule,
    EventsModule,
  ],
  providers: [WorkerRuntime],
})
export class WorkerModule {}

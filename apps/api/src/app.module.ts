import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ProblemDetailsFilter } from './common/errors/problem-details.filter.js';
import { RateLimitGuard } from './common/rate-limit/rate-limit.js';
import { ConfigModule } from './config/config.module.js';
import { PrismaModule } from './infra/prisma/prisma.module.js';
import { RedisModule } from './infra/redis.module.js';
import { PlatformModule } from './common/platform.module.js';
import { OrganizationsModule } from './modules/organizations/organizations.module.js';
import { TeamsModule } from './modules/teams/teams.module.js';
import { TournamentsModule } from './modules/tournaments/tournaments.module.js';
import { RegistrationsModule } from './modules/registrations/registrations.module.js';
import { CompetitionModule } from './modules/competition/competition.module.js';
import { MatchesModule } from './modules/matches/matches.module.js';
import { DisputesModule } from './modules/disputes/disputes.module.js';
import { StorageModule } from './infra/storage/storage.service.js';
import { PublicModule } from './modules/public/public.module.js';
import { CacheModule } from './infra/cache/cache.service.js';
import { RealtimeModule } from './modules/realtime/realtime.module.js';
import { EventsModule } from './modules/events/events.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { HealthController } from './modules/health/health.controller.js';
import { MetricsModule } from './modules/metrics/metrics.module.js';

const isDev = process.env.NODE_ENV === 'development';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'test' ? 'silent' : (process.env.LOG_LEVEL ?? 'info'),
        genReqId: (req) => (req as unknown as { id: string }).id,
        redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
        autoLogging: { ignore: (req) => req.url === '/metrics' },
        transport: isDev ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
      },
    }),
    PrismaModule,
    StorageModule,
    CacheModule,
    RedisModule,
    MetricsModule,
    PlatformModule,
    IdentityModule,
    OrganizationsModule,
    TeamsModule,
    TournamentsModule,
    RegistrationsModule,
    CompetitionModule,
    MatchesModule,
    DisputesModule,
    NotificationsModule,
    EventsModule,
    RealtimeModule,
    PublicModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class AppModule {}

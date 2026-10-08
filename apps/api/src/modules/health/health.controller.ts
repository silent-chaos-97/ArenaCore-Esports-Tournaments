import { Controller, Get, HttpStatus, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { REDIS } from '../../infra/redis.module.js';
import { Public } from '../../common/auth/decorators.js';

@Public()
@Controller('health')
export class HealthController {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<{ status: 'ok'; checks: Record<string, 'up'> }> {
    const checks: Record<string, 'up' | 'down'> = {};
    checks.redis = await this.redis
      .ping()
      .then(() => 'up' as const)
      .catch(() => 'down' as const);
    checks.database = await this.prisma.$queryRaw`SELECT 1`
      .then(() => 'up' as const)
      .catch(() => 'down' as const);
    if (Object.values(checks).includes('down')) {
      throw new ServiceUnavailableException({
        message: 'Dependency unavailable',
        checks,
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      });
    }
    return { status: 'ok', checks: checks as Record<string, 'up'> };
  }
}

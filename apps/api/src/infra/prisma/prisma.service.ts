import { HttpStatus, Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { ApiEnv } from '@arenacore/shared';
import { PrismaPg } from '@prisma/adapter-pg';
import { registerProblemMapper } from '../../common/errors/problem-details.filter.js';
import { API_ENV } from '../../config/config.module.js';
import { Prisma, PrismaClient } from '../../generated/prisma/client.js';

export type Tx = Prisma.TransactionClient;

registerProblemMapper((error) => {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return undefined;
  if (error.code === 'P2002') {
    return {
      type: 'https://arenacore.dev/problems/conflict',
      title: 'Resource already exists',
      status: HttpStatus.CONFLICT,
      code: 'UNIQUE_VIOLATION',
      target: (error.meta as { target?: unknown } | undefined)?.target,
    };
  }
  if (error.code === 'P2025') {
    return {
      type: 'about:blank',
      title: 'Resource not found',
      status: HttpStatus.NOT_FOUND,
      code: 'NOT_FOUND',
    };
  }
  return undefined;
});

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(API_ENV) env: ApiEnv) {
    super({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

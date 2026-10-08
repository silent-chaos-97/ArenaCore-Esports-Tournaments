import { Global, Module } from '@nestjs/common';
import { parseApiEnv } from '@arenacore/shared';

export const API_ENV = Symbol('API_ENV');

@Global()
@Module({
  providers: [{ provide: API_ENV, useFactory: () => parseApiEnv(process.env) }],
  exports: [API_ENV],
})
export class ConfigModule {}

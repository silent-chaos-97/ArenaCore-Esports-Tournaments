import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import type { ApiEnv } from '@arenacore/shared';
import { AuthGuard } from '../../common/auth/auth.guard.js';
import { API_ENV } from '../../config/config.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { MfaService } from './mfa.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [API_ENV],
      useFactory: (env: ApiEnv) => ({
        secret: env.JWT_ACCESS_SECRET,
        signOptions: {
          expiresIn: env.JWT_ACCESS_TTL_SECONDS,
          issuer: 'arenacore',
          audience: 'arenacore-api',
        },
        verifyOptions: { issuer: 'arenacore', audience: 'arenacore-api' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    MfaService,
    PasswordService,
    SessionService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [PasswordService, SessionService, MfaService],
})
export class IdentityModule {}

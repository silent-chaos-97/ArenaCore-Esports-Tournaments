import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AUTH_ERROR_CODES,
  loginSchema,
  mfaCodeBodySchema,
  registerSchema,
  type ApiEnv,
  type AuthTokens,
  type LoginInput,
  type MeResponse,
  type MfaCodeInput,
  type RegisterInput,
} from '@arenacore/shared';
import type { Request, Response } from 'express';
import type { AuthUser } from '../../common/auth/auth.types.js';
import { CurrentUser, Public } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.js';
import { API_ENV } from '../../config/config.module.js';
import { AuthService } from './auth.service.js';
import type { IssuedSession } from './session.service.js';
import { SessionService } from './session.service.js';

export const REFRESH_COOKIE = 'ac_rt';
const AUTH_RATE_LIMIT = { limit: 10, windowSeconds: 60 };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  @Public()
  @RateLimit(AUTH_RATE_LIMIT)
  @Post('register')
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokens> {
    return this.respond(res, await this.auth.register(body, clientOf(req)));
  }

  @Public()
  @RateLimit(AUTH_RATE_LIMIT)
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokens> {
    return this.respond(res, await this.auth.login(body, clientOf(req)));
  }

  @Public()
  @RateLimit({ limit: 30, windowSeconds: 60 })
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokens> {
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!token) {
      throw new UnauthorizedException({
        message: 'No refresh session',
        code: AUTH_ERROR_CODES.SESSION_INVALID,
      });
    }
    try {
      return this.respond(res, await this.sessions.rotate(token, clientOf(req)));
    } catch (error) {
      this.clearCookie(res);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (token) await this.sessions.revoke(token);
    this.clearCookie(res);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<MeResponse> {
    return this.auth.me(user.id);
  }

  @Post('mfa/setup')
  @HttpCode(200)
  mfaSetup(
    @CurrentUser() user: AuthUser,
  ): Promise<{ secret: string; otpauthUrl: string; qrDataUrl: string }> {
    return this.auth.beginMfaSetup(user.id);
  }

  @RateLimit(AUTH_RATE_LIMIT)
  @Post('mfa/enable')
  @HttpCode(200)
  async mfaEnable(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(mfaCodeBodySchema)) body: MfaCodeInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokens> {
    return this.respond(res, await this.auth.enableMfa(user.id, body.code, clientOf(req)));
  }

  @RateLimit(AUTH_RATE_LIMIT)
  @Post('mfa/disable')
  @HttpCode(204)
  async mfaDisable(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(mfaCodeBodySchema)) body: MfaCodeInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.disableMfa(user.id, body.code);
    this.clearCookie(res);
  }

  private respond(res: Response, session: IssuedSession): AuthTokens {
    res.cookie(REFRESH_COOKIE, session.refreshToken, {
      httpOnly: true,
      secure: this.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/v1/auth',
      expires: session.refreshExpiresAt,
    });
    return { accessToken: session.accessToken, expiresIn: session.expiresIn };
  }

  private clearCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  }
}

function clientOf(req: Request): { userAgent?: string; ip?: string } {
  return { userAgent: req.header('user-agent'), ip: req.ip };
}

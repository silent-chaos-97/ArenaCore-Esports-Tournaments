import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { getRequestContext } from '../context/request-context.js';
import type { AccessTokenClaims } from './auth.types.js';
import { IS_PUBLIC } from './decorators.js';

/** Global bearer-token guard. Public routes still get `req.user` when a valid token is sent. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);

    const token = this.extractToken(req);
    if (token) {
      try {
        const claims = await this.jwt.verifyAsync<AccessTokenClaims>(token);
        req.user = { id: claims.sub, sessionId: claims.sid, mfa: claims.mfa };
        const ctx = getRequestContext();
        if (ctx) ctx.userId = claims.sub;
      } catch {
        if (!isPublic) throw new UnauthorizedException('Invalid or expired access token');
      }
    }
    if (!isPublic && !req.user) throw new UnauthorizedException('Authentication required');
    return true;
  }

  private extractToken(req: Request): string | undefined {
    const header = req.header('authorization');
    if (header?.startsWith('Bearer ')) return header.slice(7);
    // EventSource cannot send headers; SSE endpoints accept ?access_token=.
    const query = req.query.access_token;
    return typeof query === 'string' && req.path.endsWith('/stream') ? query : undefined;
  }
}

import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ApiEnv } from '@arenacore/shared';
import type { Request, Response } from 'express';
import type { Redis } from 'ioredis';
import { API_ENV } from '../../config/config.module.js';
import { REDIS } from '../../infra/redis.module.js';

export interface RateLimitOptions {
  limit: number;
  windowSeconds: number;
}

const RATE_LIMIT_KEY = 'arenacore:rate-limit';
const DEFAULT_LIMIT: RateLimitOptions = { limit: 300, windowSeconds: 60 };

/** Override the default per-IP fixed-window limit for a handler or controller. */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.env.DISABLE_RATE_LIMIT || context.getType() !== 'http') return true;
    const { limit, windowSeconds } =
      this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? DEFAULT_LIMIT;

    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const window = Math.floor(Date.now() / 1000 / windowSeconds);
    const route = `${context.getClass().name}.${context.getHandler().name}`;
    const key = `rl:${route}:${req.ip}:${window}`;

    const [[, count]] = (await this.redis.multi().incr(key).expire(key, windowSeconds).exec()) as [
      [unknown, number],
    ];
    res.setHeader('RateLimit-Limit', limit);
    res.setHeader('RateLimit-Remaining', Math.max(0, limit - count));
    if (count > limit) {
      res.setHeader('Retry-After', windowSeconds);
      throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}

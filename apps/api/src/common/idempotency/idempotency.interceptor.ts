import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
  UnprocessableEntityException,
  UseInterceptors,
  applyDecorators,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { catchError, from, map, Observable, of, switchMap, throwError } from 'rxjs';
import { sha256 } from '../crypto/secret-box.js';
import { Prisma, type IdempotencyRecord } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

const SCOPE_KEY = 'arenacore:idempotency-scope';
const TTL_MS = 24 * 60 * 60 * 1000;
const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

/**
 * Honours the `Idempotency-Key` header: the first request's response is stored and replayed for
 * retries with the same key; reusing a key with a different payload is rejected.
 */
export const Idempotent = (scope: string) =>
  applyDecorators(SetMetadata(SCOPE_KEY, scope), UseInterceptors(IdempotencyInterceptor));

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const key = req.header('idempotency-key');
    if (!key) return next.handle();
    if (!KEY_PATTERN.test(key))
      throw new UnprocessableEntityException('Malformed Idempotency-Key header');

    const scope = `${this.reflector.get<string>(SCOPE_KEY, context.getHandler())}:${req.user?.id ?? 'anon'}`;
    const requestHash = sha256(
      JSON.stringify({ m: req.method, p: req.originalUrl, b: req.body ?? null }),
    );

    return from(this.claim(scope, key, requestHash, req.user?.id)).pipe(
      switchMap((existing) => {
        if (existing) {
          if (existing.requestHash !== requestHash) {
            throw new UnprocessableEntityException({
              message: 'Idempotency-Key was already used with a different request',
              code: 'IDEMPOTENCY_KEY_REUSED',
            });
          }
          if (existing.statusCode === null) {
            throw new ConflictException({
              message: 'A request with this key is still in progress',
              code: 'IDEMPOTENCY_IN_PROGRESS',
            });
          }
          res.status(existing.statusCode).setHeader('Idempotent-Replayed', 'true');
          return of(existing.responseBody);
        }
        return next.handle().pipe(
          switchMap((body) =>
            from(
              this.prisma.idempotencyRecord.update({
                where: { scope_key: { scope, key } },
                data: {
                  statusCode: res.statusCode,
                  responseBody: (body ?? null) as Prisma.InputJsonValue,
                },
              }),
            ).pipe(map(() => body)),
          ),
          catchError((error: unknown) =>
            // Failed requests release the key so the client can retry.
            from(this.prisma.idempotencyRecord.deleteMany({ where: { scope, key } })).pipe(
              switchMap(() => throwError(() => error)),
            ),
          ),
        );
      }),
    );
  }

  /** Inserts a placeholder; returns the existing record when the key was already claimed. */
  private async claim(
    scope: string,
    key: string,
    requestHash: string,
    userId?: string,
  ): Promise<IdempotencyRecord | null> {
    try {
      await this.prisma.idempotencyRecord.create({
        data: { scope, key, requestHash, userId, expiresAt: new Date(Date.now() + TTL_MS) },
      });
      return null;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.idempotencyRecord.findUniqueOrThrow({
          where: { scope_key: { scope, key } },
        });
        if (existing.expiresAt > new Date()) return existing;
        await this.prisma.idempotencyRecord.delete({ where: { id: existing.id } });
        return this.claim(scope, key, requestHash, userId);
      }
      throw error;
    }
  }
}

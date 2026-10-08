import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { InvalidTransitionError } from '@arenacore/shared';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { currentRequestId } from '../context/request-context.js';
import { DomainError } from './domain-error.js';

export type Problem = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  code?: string;
  errors?: unknown;
} & Record<string, unknown>;

export type ProblemDetails = Problem & { instance?: string; requestId?: string };

type Mapper = (exception: unknown) => Problem | undefined;

const mappers: Mapper[] = [];

/** Lets infrastructure modules (e.g. Prisma) translate their own errors without coupling. */
export function registerProblemMapper(mapper: Mapper): void {
  mappers.push(mapper);
}

function toProblem(exception: unknown): Problem {
  if (exception instanceof DomainError) {
    return {
      type: `https://arenacore.dev/problems/${exception.code.toLowerCase().replaceAll('_', '-')}`,
      title: exception.message,
      status: exception.status,
      code: exception.code,
      ...exception.details,
    };
  }
  if (exception instanceof InvalidTransitionError) {
    return {
      type: 'https://arenacore.dev/problems/invalid-transition',
      title: exception.message,
      status: HttpStatus.CONFLICT,
      code: 'INVALID_TRANSITION',
      from: exception.from,
      to: exception.to,
    };
  }
  if (exception instanceof ZodError) {
    return {
      type: 'https://arenacore.dev/problems/validation',
      title: 'Request validation failed',
      status: HttpStatus.BAD_REQUEST,
      code: 'VALIDATION_FAILED',
      errors: exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const body = exception.getResponse();
    const message =
      typeof body === 'string'
        ? body
        : ((body as { message?: string | string[] }).message ?? exception.message);
    const extra =
      typeof body === 'object' && body !== null
        ? Object.fromEntries(
            Object.entries(body).filter(([k]) => !['message', 'statusCode', 'error'].includes(k)),
          )
        : {};
    return {
      type: 'about:blank',
      title: Array.isArray(message) ? message.join('; ') : message,
      status,
      ...extra,
    };
  }
  for (const mapper of mappers) {
    const mapped = mapper(exception);
    if (mapped) return mapped;
  }
  return {
    type: 'about:blank',
    title: 'Internal Server Error',
    status: HttpStatus.INTERNAL_SERVER_ERROR,
  };
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const problem: ProblemDetails = {
      ...toProblem(exception),
      instance: req.originalUrl,
      requestId: currentRequestId(),
    };
    if (problem.status >= 500) this.logger.error(exception);
    if (res.headersSent) return;
    res.status(problem.status).type('application/problem+json').json(problem);
  }
}

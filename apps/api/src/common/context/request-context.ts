import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export interface RequestContext {
  requestId: string;
  userId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

/** Accepts a well-formed inbound X-Request-Id or generates one, and scopes it to the request. */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.header('x-request-id');
  const requestId = inbound && REQUEST_ID_PATTERN.test(inbound) ? inbound : randomUUID();
  (req as Request & { id: string }).id = requestId;
  res.setHeader('x-request-id', requestId);
  storage.run({ requestId }, () => next());
}

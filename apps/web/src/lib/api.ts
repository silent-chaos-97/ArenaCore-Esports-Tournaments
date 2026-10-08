import type { AuthTokens } from '@arenacore/shared';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

/** A failed API call, carrying the RFC 9457 problem body. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
    readonly problem: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field-level messages from validation problems, keyed by path. */
  get fieldErrors(): Record<string, string> {
    const errors = this.problem.errors;
    if (!Array.isArray(errors)) return {};
    return Object.fromEntries(
      errors
        .filter((e): e is { path: string; message: string } => typeof e?.path === 'string')
        .map((e) => [e.path, e.message]),
    );
  }
}

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
const tokenListeners = new Set<(token: string | null) => void>();

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
  tokenListeners.forEach((l) => l(token));
}

export function onAccessToken(listener: (token: string | null) => void): () => void {
  tokenListeners.add(listener);
  return () => tokenListeners.delete(listener);
}

/** Rotates the httpOnly refresh cookie into a new access token (single flight). */
export function refreshSession(): Promise<boolean> {
  refreshing ??= fetch(`${API_URL}/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then(async (res) => {
      if (!res.ok) {
        setAccessToken(null);
        return false;
      }
      setAccessToken(((await res.json()) as AuthTokens).accessToken);
      return true;
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Sends Idempotency-Key so retries of this action are safe. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export async function api<T>(
  path: string,
  options: RequestOptions = {},
  retried = false,
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;

  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: 'include',
    signal: options.signal,
  });

  if (res.status === 401 && !retried && !path.startsWith('/auth/')) {
    if (await refreshSession()) return api<T>(path, options, true);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const problem = (body ?? {}) as Record<string, unknown>;
    throw new ApiError(
      res.status,
      typeof problem.code === 'string' ? problem.code : undefined,
      typeof problem.title === 'string' ? problem.title : `Request failed (${res.status})`,
      problem,
    );
  }
  return body as T;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

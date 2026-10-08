'use client';

import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useState } from 'react';
import { useToast } from '@/components/ui/feedback';
import { api, newIdempotencyKey, type RequestOptions } from './api';
import { useAuth } from './auth';

/** GET with react-query; waits for the session before firing authenticated requests. */
export function useApi<T>(
  path: string | null,
  options: { key?: QueryKey; publicRoute?: boolean; refetchInterval?: number } = {},
) {
  const { status } = useAuth();
  return useQuery({
    queryKey: options.key ?? [path],
    queryFn: ({ signal }) => api<T>(path!, { signal }),
    enabled: path !== null && (options.publicRoute || status === 'signed-in'),
    refetchInterval: options.refetchInterval,
  });
}

/**
 * Runs a write, shows a toast named after the action, refreshes affected queries and keeps the
 * idempotency key stable across retries of the same attempt.
 */
export function useAction<TInput = void, TResult = unknown>(
  request: (input: TInput) => { path: string } & RequestOptions,
  options: {
    success?: string | ((result: TResult) => string);
    invalidate?: QueryKey[];
    idempotent?: boolean;
    onSuccess?: (result: TResult) => void;
  } = {},
) {
  const client = useQueryClient();
  const toast = useToast();
  const [key, setKey] = useState(newIdempotencyKey);
  return useMutation<TResult, Error, TInput>({
    mutationFn: (input) => {
      const { path, ...rest } = request(input);
      return api<TResult>(path, { ...rest, idempotencyKey: options.idempotent ? key : undefined });
    },
    onSuccess: async (result) => {
      setKey(newIdempotencyKey());
      if (options.success)
        toast(typeof options.success === 'function' ? options.success(result) : options.success);
      await Promise.all(
        (options.invalidate ?? []).map((k) => client.invalidateQueries({ queryKey: k })),
      );
      options.onSuccess?.(result);
    },
  });
}

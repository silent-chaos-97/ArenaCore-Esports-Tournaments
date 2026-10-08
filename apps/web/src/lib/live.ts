'use client';

import { useEffect, useRef } from 'react';
import { API_URL, getAccessToken, onAccessToken } from './api';

/**
 * Subscribes to an ArenaCore SSE stream. Private streams pass the access token as a query
 * parameter (EventSource can't send headers) and reconnect whenever the token rotates.
 */
export function useEventStream(
  path: string | null,
  onEvent: (type: string, data: unknown) => void,
  options: { authenticated?: boolean; types?: string[] } = {},
): void {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const types = (options.types ?? []).join(',');

  useEffect(() => {
    if (!path) return;
    let source: EventSource | null = null;
    const connect = () => {
      source?.close();
      const token = getAccessToken();
      if (options.authenticated && !token) return;
      const url = `${API_URL}${path}${options.authenticated ? `?access_token=${encodeURIComponent(token!)}` : ''}`;
      source = new EventSource(url);
      for (const type of types ? types.split(',') : ['message']) {
        source.addEventListener(type, (e) =>
          handler.current(type, JSON.parse((e as MessageEvent<string>).data)),
        );
      }
    };
    connect();
    const unsubscribe = options.authenticated ? onAccessToken(connect) : () => undefined;
    return () => {
      unsubscribe();
      source?.close();
    };
  }, [path, options.authenticated, types]);
}

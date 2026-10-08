'use client';

import type { AuthTokens, MeResponse } from '@arenacore/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, refreshSession, setAccessToken } from './api';
import { readPreference, writePreference } from './preferences';

interface AuthState {
  status: 'loading' | 'signed-in' | 'signed-out';
  user: MeResponse | null;
  activeOrgId: string | null;
  setActiveOrgId(id: string): void;
  login(input: { email: string; password: string; mfaCode?: string }): Promise<void>;
  register(input: { email: string; password: string; displayName: string }): Promise<void>;
  logout(): Promise<void>;
  reload(): Promise<void>;
  /** Replaces the session after an MFA upgrade. */
  adoptTokens(tokens: AuthTokens): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [user, setUser] = useState<MeResponse | null>(null);
  const [activeOrgId, setActiveOrg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const me = await api<MeResponse>('/auth/me');
    setUser(me);
    setStatus('signed-in');
    const saved = readPreference('activeOrgId');
    const valid = me.memberships.find((m) => m.organizationId === saved) ?? me.memberships[0];
    setActiveOrg(valid?.organizationId ?? null);
  }, []);

  useEffect(() => {
    void (async () => {
      if (await refreshSession()) {
        await reload().catch(() => setStatus('signed-out'));
      } else {
        setStatus('signed-out');
      }
    })();
  }, [reload]);

  const adoptTokens = useCallback(
    async (tokens: AuthTokens) => {
      setAccessToken(tokens.accessToken);
      await reload();
    },
    [reload],
  );

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      activeOrgId,
      setActiveOrgId(id) {
        setActiveOrg(id);
        writePreference('activeOrgId', id);
      },
      async login(input) {
        await adoptTokens(await api<AuthTokens>('/auth/login', { method: 'POST', body: input }));
      },
      async register(input) {
        await adoptTokens(await api<AuthTokens>('/auth/register', { method: 'POST', body: input }));
      },
      async logout() {
        await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
        setAccessToken(null);
        setUser(null);
        setStatus('signed-out');
      },
      reload,
      adoptTokens,
    }),
    [status, user, activeOrgId, reload, adoptTokens],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

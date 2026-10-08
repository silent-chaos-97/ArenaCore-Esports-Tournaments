'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api';

/** Inline error for a failed action: says what happened and, where known, how to fix it. */
export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const message =
    error instanceof ApiError
      ? error.message
      : error instanceof Error
        ? error.message
        : 'Something went wrong.';
  const details =
    error instanceof ApiError && Array.isArray(error.problem.errors)
      ? (error.problem.errors as { message: string }[])
      : [];
  return (
    <div
      role="alert"
      className="rounded-md border border-loss/30 bg-loss-wash px-3 py-2 text-[15px] text-loss"
    >
      <p className="font-semibold">{message}</p>
      {details.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-sm">
          {details.map((d, i) => (
            <li key={i}>{d.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-rule px-6 py-10">
      <h3 className="text-xl font-semibold">{title}</h3>
      {children && <div className="max-w-prose text-[15px] text-muted">{children}</div>}
      {action}
    </div>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 py-8 text-muted">
      <span
        className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent"
        aria-hidden
      />
      {label}…
    </div>
  );
}

interface Toast {
  id: number;
  message: string;
}
const ToastContext = createContext<(message: string) => void>(() => undefined);

/** Brief confirmations that name the action that just happened ("Published"). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="rounded-md bg-ink px-4 py-2.5 text-[15px] font-medium text-paper shadow-lg"
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): (message: string) => void {
  return useContext(ToastContext);
}

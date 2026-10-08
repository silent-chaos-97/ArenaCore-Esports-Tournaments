'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/** Native <dialog>: focus trapping, Escape and backdrop come from the platform. */
export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(560px,calc(100vw-32px))] rounded-lg border border-rule bg-surface p-0 text-ink backdrop:bg-ink/40"
    >
      <div className="flex items-center justify-between border-b border-rule px-5 py-3">
        <h2 className="text-2xl font-semibold">{title}</h2>
        <button
          onClick={onClose}
          className="rounded px-2 text-2xl leading-none text-muted hover:text-ink"
          aria-label="Close"
        >
          ×
        </button>
      </div>
      <div className="px-5 py-4">{open && children}</div>
    </dialog>
  );
}

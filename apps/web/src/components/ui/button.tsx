import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const styles: Record<Variant, string> = {
  primary: 'bg-cobalt text-white hover:bg-cobalt-ink disabled:bg-cobalt/50',
  secondary: 'border border-rule bg-surface text-ink hover:border-muted disabled:text-muted',
  ghost: 'text-cobalt hover:bg-cobalt-wash disabled:text-muted',
  danger: 'bg-loss text-white hover:bg-loss/90 disabled:bg-loss/50',
};

export function Button({
  variant = 'primary',
  busy = false,
  className = '',
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      {...props}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-[15px] font-semibold transition-colors disabled:cursor-not-allowed ${styles[variant]} ${className}`}
    >
      {busy && (
        <span
          className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"
          aria-hidden
        />
      )}
      {children}
    </button>
  );
}

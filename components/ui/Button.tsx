import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger';

const VARIANTS: Record<Variant, string> = {
  // Road-sign amber with ink text and a hard "sign" shadow.
  primary:
    'border-2 border-line bg-accent text-on-accent shadow-sign active:translate-y-0.5 active:shadow-sign-pressed',
  secondary: 'border-2 border-line bg-surface text-ink hover:bg-surface-sunk',
  quiet: 'border-2 border-transparent text-accent-ink underline decoration-2 underline-offset-4',
  danger: 'border-2 border-danger bg-surface text-danger hover:bg-surface-sunk',
};

export function buttonClass(variant: Variant = 'primary', block = false) {
  return [
    'inline-flex min-h-12 items-center justify-center gap-2 rounded-md px-5 font-heading text-base font-bold',
    'transition-[transform,box-shadow] duration-100 disabled:cursor-not-allowed disabled:opacity-60',
    VARIANTS[variant],
    block ? 'w-full' : '',
  ].join(' ');
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  block?: boolean;
  busy?: boolean;
  /** Text announced while busy (e.g. "กำลังส่ง…"). */
  busyLabel?: string;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  block = false,
  busy = false,
  busyLabel,
  disabled,
  className = '',
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`${buttonClass(variant, block)} ${className}`}
      {...rest}
    >
      {busy && <Spinner />}
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none ${className}`}
    />
  );
}

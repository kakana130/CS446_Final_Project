import type { ReactNode } from 'react';

type Tone = 'info' | 'success' | 'error' | 'highlight';

const TONES: Record<Tone, string> = {
  info: 'border-line-soft bg-surface',
  success: 'border-success bg-surface',
  error: 'border-danger bg-surface',
  highlight: 'border-line bg-accent-soft',
};

export function Alert({
  tone = 'info',
  title,
  children,
  live = false,
}: {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
  /** Announce to screen readers when it appears. */
  live?: boolean;
}) {
  return (
    <div
      role={live ? (tone === 'error' ? 'alert' : 'status') : undefined}
      className={`rounded-md border-2 p-4 ${TONES[tone]}`}
    >
      {title && (
        <p className={`font-heading font-bold ${tone === 'error' ? 'text-danger' : ''}`}>{title}</p>
      )}
      {children && <div className={title ? 'mt-1' : ''}>{children}</div>}
    </div>
  );
}

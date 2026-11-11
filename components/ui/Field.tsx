'use client';

import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';

interface FieldProps {
  label: string;
  hint?: ReactNode;
  /** Translated error text, shown next to the field. */
  error?: string | null;
  optional?: string;
  children: (ids: {
    inputId: string;
    describedBy: string | undefined;
    invalid: boolean;
  }) => ReactNode;
}

/** Label, hint and error wiring (aria-describedby / aria-invalid) for any control. */
export function Field({ label, hint, error, optional, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={`${id}-input`} className="block font-semibold">
        {label}
        {optional && <span className="ms-2 text-sm font-normal text-ink-muted">{optional}</span>}
      </label>
      {hint && (
        <p id={hintId} className="text-sm text-ink-muted">
          {hint}
        </p>
      )}
      {children({ inputId: `${id}-input`, describedBy, invalid: Boolean(error) })}
      {error && (
        <p id={errorId} role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export const inputClass =
  'block min-h-12 w-full rounded-md border-2 border-line bg-surface px-3 text-base text-ink ' +
  'placeholder:text-ink-muted aria-[invalid=true]:border-danger';

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ''}`} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      rows={3}
      {...props}
      className={`${inputClass} min-h-24 py-2 leading-relaxed ${props.className ?? ''}`}
    />
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
  error,
  children,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string | null;
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="mt-1 size-6 shrink-0 accent-[var(--p-ink)]"
        />
        <label htmlFor={id} className="flex-1">
          {label}
          {children}
        </label>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

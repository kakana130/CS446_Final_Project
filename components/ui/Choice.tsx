'use client';

import { useId } from 'react';

interface Option<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

const COLUMNS: Record<number, string> = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3' };

/** Large, radio-based segmented choice (plate type, handover location). */
export function Choice<T extends string>({
  legend,
  options,
  value,
  onChange,
  columns = options.length,
  pills = false,
}: {
  legend: string;
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
  columns?: number;
  /** A small inline row of pills (a secondary choice with a sensible default). */
  pills?: boolean;
}) {
  const name = useId();
  if (pills) {
    return (
      <fieldset className="flex flex-wrap items-center gap-2">
        <legend className="sr-only">{legend}</legend>
        <span aria-hidden="true" className="text-sm font-semibold">
          {legend}
        </span>
        {options.map((o) => (
          <label
            key={o.value}
            className="inline-flex min-h-11 cursor-pointer items-center rounded-full border-2 border-line-soft bg-surface px-3 text-sm font-semibold has-[:checked]:border-line has-[:checked]:bg-accent-soft has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-focus"
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.label}
          </label>
        ))}
      </fieldset>
    );
  }
  // Three narrow columns on a phone: stack the radio above the label so the text fits.
  const compact = columns >= 3;
  return (
    <fieldset>
      <legend className="mb-1.5 font-semibold">{legend}</legend>
      <div className={`grid gap-2 ${COLUMNS[columns] ?? 'grid-cols-1'}`}>
        {options.map((o) => (
          <label
            key={o.value}
            className={`flex min-h-12 cursor-pointer flex-col justify-center rounded-md border-2 border-line-soft bg-surface py-2 has-[:checked]:border-line has-[:checked]:bg-accent-soft has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-focus ${compact ? 'px-1.5 text-center' : 'px-3'}`}
          >
            <span
              className={compact ? 'flex flex-col items-center gap-1' : 'flex items-center gap-2'}
            >
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={value === o.value}
                onChange={() => onChange(o.value)}
                className="size-5 accent-[var(--p-ink)]"
              />
              <span className={`font-semibold ${compact ? 'text-sm leading-snug' : ''}`}>
                {o.label}
              </span>
            </span>
            {o.hint && <span className="ms-7 text-sm text-ink-muted">{o.hint}</span>}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

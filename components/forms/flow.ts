'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import type { PlateFieldErrors } from '@/components/plate/PlateInput';

/**
 * Flow step lives in `?step=` so the browser Back button moves between steps; form state
 * stays in the component (and a sessionStorage draft), so going back never loses input.
 */
export function useStep<T extends string>(steps: readonly T[]): [T, (step: T) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = params.get('step');
  const current = steps.includes(raw as T) ? (raw as T) : steps[0]!;
  const go = useCallback(
    (step: T) => {
      router.push(step === steps[0] ? pathname : `${pathname}?step=${step}`);
      window.scrollTo({ top: 0 });
    },
    [router, pathname, steps],
  );
  return [current, go];
}

/** Map API/zod field paths under `prefix` (e.g. "plate.number") to plate input zones. */
export function plateErrorsFrom(
  fields: Record<string, string>,
  text: (code: string | null | undefined) => string | null,
  prefix = '',
): PlateFieldErrors {
  const get = (k: string) => fields[`${prefix}${k}`];
  return {
    series: text(get('letters') ?? get('prefixDigit')),
    number: text(get('number')),
    provinceCode: text(get('provinceCode')),
  };
}

/** Pick the fields under `prefix` and translate them. */
export function errorsUnder(
  fields: Record<string, string>,
  prefix: string,
  text: (code: string | null | undefined) => string | null,
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (k.startsWith(prefix)) out[k.slice(prefix.length)] = text(v);
  }
  return out;
}

export function readDraft<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeDraft(key: string, value: unknown): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: drafts just won't survive a reload.
  }
}

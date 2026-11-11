'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Sheet } from '@/components/ui/Sheet';
import { inputClass } from '@/components/ui/Field';
import { searchProvinces } from '@/lib/plate/provinces';

const rowClass =
  'flex min-h-12 w-full items-center justify-between gap-3 px-2 text-start hover:bg-surface-sunk';

/**
 * Searchable province list (Thai, English, aliases such as กทม / โคราช). A fixed-height
 * sheet, so the title and the search box stay put while the list filters (D-087).
 */
export function ProvinceSheet({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (code: string | null) => void;
}) {
  const t = useTranslations();
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchProvinces(query), [query]);

  const pick = (code: string | null) => {
    onSelect(code);
    setQuery('');
    onClose();
  };

  // With a mouse, typing right away is handy. On a phone it would pop the keyboard over the
  // list, so the search box waits for a tap there.
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open && window.matchMedia('(pointer: fine)').matches) search.current?.focus();
  }, [open]);

  return (
    <Sheet
      open={open}
      onClose={() => {
        setQuery('');
        onClose();
      }}
      title={t('plate.provinceSheetTitle')}
      closeLabel={t('common.close')}
      fill
    >
      {/* The search box stays in view while the list scrolls under it. */}
      <div className="sticky -top-4 z-10 -mx-4 -mt-4 bg-surface px-4 pt-4 pb-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('plate.provinceSearch')}
          aria-label={t('plate.provinceSearch')}
          className={inputClass}
          autoComplete="off"
          ref={search}
        />
      </div>
      <ul className="divide-y-2 divide-line-soft">
        {!query && (
          <li>
            <button type="button" className={rowClass} onClick={() => pick(null)}>
              <span className="font-semibold">{t('plate.provinceUnknown')}</span>
            </button>
          </li>
        )}
        {results.map((p) => (
          <li key={p.code}>
            <button type="button" className={rowClass} onClick={() => pick(p.code)}>
              <span lang="th">{p.name_th}</span>
              <span lang="en" className="text-sm text-ink-muted">
                {p.name_en}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {results.length === 0 && <p className="mt-3 text-ink-muted">{t('plate.provinceNone')}</p>}
    </Sheet>
  );
}

'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useId, useRef, useState } from 'react';
import { Choice } from '@/components/ui/Choice';
import { headerControl } from '@/components/ui/styles';
import { splitPlateText, type PlateDraft } from '@/lib/plate/draft';
import { provinceName } from '@/lib/plate/provinces';
import type { PlateType } from '@/lib/plate/types';
import { ConsonantSheet } from './ConsonantSheet';
import { PlateFrame } from './PlateView';
import { ProvinceSheet } from './ProvinceSheet';

export type PlateFieldErrors = Partial<Record<'series' | 'number' | 'provinceCode', string | null>>;

/**
 * The signature component: a plate-shaped input. The whole plate is typed in one field, the
 * way people read it off the plate ("กค7812", "1กข 1234"); it is split into series and number
 * automatically and the reading is shown back underneath. The province opens a searchable
 * sheet. `?` marks unreadable characters; its button shows only where a plate may be hard to
 * read (`unreadable`: the found flow), and the ก–ฮ picker only off the Thai site, since phones
 * in Thailand have a Thai keyboard (D-097).
 */
export function PlateInput({
  value,
  onChange,
  errors = {},
  unreadable = false,
  onEnter,
}: {
  value: PlateDraft;
  onChange: (draft: PlateDraft) => void;
  errors?: PlateFieldErrors;
  unreadable?: boolean;
  /**
   * The keyboard's Enter key runs this (e.g. a search) and is labelled "search". Not a form:
   * the province sheet's own search box sits inside this component and must not submit.
   */
  onEnter?: () => void;
}) {
  const t = useTranslations('plate');
  const letters = useLocale() !== 'th';
  const id = useId();
  const textRef = useRef<HTMLInputElement>(null);
  const [provinceOpen, setProvinceOpen] = useState(false);
  const [lettersOpen, setLettersOpen] = useState(false);

  const set = (patch: Partial<PlateDraft>) => onChange({ ...value, ...patch });
  const append = (ch: string) => {
    set({ text: `${value.text}${ch}` });
    textRef.current?.focus();
  };

  const province = provinceName(value.provinceCode, 'th');
  const parsed = splitPlateText(value.text, value.type);
  const textError = errors.series ?? errors.number;
  const describedBy = [
    `${id}-instructions`,
    value.text.trim() ? `${id}-parsed` : null,
    textError ? `${id}-text-error` : null,
  ]
    .filter(Boolean)
    .join(' ');
  // Long plates ("1กข 1234") shrink a little so they fit on a 360 px screen.
  const size = [...value.text].length > 7 ? 'text-[2.1rem]' : 'text-[2.6rem]';

  return (
    <div className="space-y-3">
      <p id={`${id}-instructions`} className="text-sm text-ink-muted">
        {t('instructions')}
      </p>

      <PlateFrame size="lg" className="mx-auto">
        <div className="py-1">
          <input
            ref={textRef}
            value={value.text}
            onChange={(e) => set({ text: e.target.value })}
            onKeyDown={(e) => {
              if (onEnter && e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                onEnter();
              }
            }}
            aria-label={t('textLabel')}
            aria-invalid={Boolean(textError) || undefined}
            aria-describedby={describedBy}
            placeholder={t('textPlaceholder')}
            lang="th"
            inputMode="text"
            enterKeyHint={onEnter ? 'search' : 'next'}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={12}
            className={`block w-full min-w-0 rounded-sm border-b-2 border-dashed border-plate-ink/40 bg-transparent text-center font-bold text-plate-ink placeholder:text-plate-ink/25 focus:border-solid focus:border-plate-ink ${size}`}
          />
          <button
            type="button"
            onClick={() => setProvinceOpen(true)}
            aria-label={`${t('provinceLabel')}: ${province ?? t('provinceChoose')}`}
            aria-describedby={errors.provinceCode ? `${id}-province-error` : undefined}
            className="mt-0.5 block min-h-11 w-full rounded-sm border-b-2 border-dashed border-plate-ink/40 text-lg font-semibold"
          >
            <span lang="th" className={province ? '' : 'text-plate-ink/45'}>
              {province ?? t('provinceChoose')}
            </span>
          </button>
        </div>
      </PlateFrame>

      {value.text.trim() && (
        <p id={`${id}-parsed`} className="text-sm text-ink-muted">
          {t('parsed', { series: parsed.series || '—', number: parsed.number || '—' })}
        </p>
      )}

      {(letters || unreadable) && (
        <div className="flex flex-wrap items-center gap-2">
          {letters && (
            <button
              type="button"
              className={headerControl}
              onClick={() => setLettersOpen(true)}
              aria-label={t('lettersButtonLabel')}
            >
              {t('lettersButton')}
            </button>
          )}
          {unreadable && (
            <>
              <button
                type="button"
                className={headerControl}
                onClick={() => append('?')}
                aria-label={t('wildcardButtonLabel')}
              >
                {t('wildcardButton')}
              </button>
              <p className="flex-1 text-sm text-ink-muted">{t('wildcardHint')}</p>
            </>
          )}
        </div>
      )}

      <Choice<PlateType>
        pills
        legend={t('typeLegend')}
        value={value.type}
        onChange={(type) => set({ type })}
        options={[
          { value: 'car', label: t('car') },
          { value: 'motorcycle', label: t('motorcycle') },
          { value: 'other', label: t('other') },
        ]}
      />

      {textError && (
        <p id={`${id}-text-error`} role="alert" className="text-sm font-semibold text-danger">
          {textError}
        </p>
      )}
      {errors.provinceCode && (
        <p id={`${id}-province-error`} role="alert" className="text-sm font-semibold text-danger">
          {errors.provinceCode}
        </p>
      )}

      <ProvinceSheet
        open={provinceOpen}
        onClose={() => setProvinceOpen(false)}
        onSelect={(provinceCode) => set({ provinceCode })}
      />
      <ConsonantSheet
        open={lettersOpen}
        onClose={() => {
          setLettersOpen(false);
          textRef.current?.focus();
        }}
        onPick={(ch) => set({ text: `${value.text}${ch}` })}
        onDelete={() => set({ text: [...value.text].slice(0, -1).join('') })}
      />
    </div>
  );
}

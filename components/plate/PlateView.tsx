import { useTranslations } from 'next-intl';
import { plateDisplay } from '@/lib/plate/canonical';
import { plateSpoken } from '@/lib/plate/draft';
import { provinceName } from '@/lib/plate/provinces';
import type { Plate } from '@/lib/plate/types';
import { plateFont } from './font';

type Size = 'xs' | 'sm' | 'md' | 'lg';

const SIZES: Record<Size, { frame: string; main: string; province: string }> = {
  xs: { frame: 'w-32 p-0.5', main: 'text-[1.3rem]', province: 'text-[0.7rem]' },
  sm: { frame: 'w-44 p-0.5', main: 'text-[1.7rem]', province: 'text-xs' },
  md: { frame: 'w-60 p-1', main: 'text-[2.3rem]', province: 'text-sm' },
  lg: { frame: 'w-full max-w-[22rem] p-1', main: 'text-[2.9rem]', province: 'text-base' },
};

/** `?` gets a dashed box so an unreadable character is obviously not a real one. */
function Chars({ text }: { text: string }) {
  return [...text].map((c, i) =>
    c === '?' ? (
      <span
        key={i}
        className="mx-[0.04em] inline-block rounded-sm border-2 border-dashed border-current px-[0.06em] leading-none"
      >
        ?
      </span>
    ) : (
      <span key={i}>{c}</span>
    ),
  );
}

/** The outer frame shared by the read-only plate and the plate input. */
export function PlateFrame({
  size = 'lg',
  children,
  className = '',
}: {
  size?: Size;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`${plateFont.variable} ${SIZES[size].frame} rounded-plate border-2 border-plate-edge bg-plate text-plate-ink ${className}`}
    >
      {/* Inner rim, as on a real Thai plate. */}
      <div className="rounded-[7px] border-[3px] border-plate-ink px-2 py-1 text-center font-plate [font-stretch:80%]">
        {children}
      </div>
    </div>
  );
}

/** Read-only plate, laid out like the real thing (motorcycles on three lines). */
export function PlateView({ plate, size = 'md' }: { plate: Plate; size?: Size }) {
  const t = useTranslations();
  const province = provinceName(plate.provinceCode, 'th');
  const display = plateDisplay(plate);
  const [series, number] = display.includes(' ') ? display.split(' ') : ['', display];
  const s = SIZES[size];
  const label = t('plate.viewLabel', {
    plate: plateSpoken(plate, t('common.unknownChar')),
    province: province ?? t('plate.provinceUnknown'),
  });

  return (
    <PlateFrame size={size}>
      <div role="img" aria-label={label}>
        {plate.type === 'motorcycle' ? (
          <>
            <p className={`${s.main} leading-tight font-bold`}>
              <Chars text={series ?? ''} />
            </p>
            <p className={`${s.province} leading-snug font-semibold`}>{province ?? '—'}</p>
            <p className={`${s.main} leading-tight font-bold`}>
              <Chars text={number ?? ''} />
            </p>
          </>
        ) : (
          <>
            <p className={`${s.main} leading-tight font-bold whitespace-nowrap`}>
              <Chars text={display} />
            </p>
            <p className={`${s.province} leading-snug font-semibold`}>{province ?? '—'}</p>
          </>
        )}
      </div>
    </PlateFrame>
  );
}

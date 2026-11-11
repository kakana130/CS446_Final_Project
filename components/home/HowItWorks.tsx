import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { CameraIcon, CheckIcon, LostPlateIcon, PhoneIcon } from '@/components/icons';
import { PlateView } from '@/components/plate/PlateView';
import type { Plate } from '@/lib/plate/types';

/** A made-up plate for the matching step. */
const EXAMPLE: Plate = {
  type: 'car',
  prefixDigit: null,
  letters: 'กข',
  number: '1234',
  provinceCode: 'TH-10',
};

/** One step on a vertical line: a big road-sign number, a bold title, then a picture. */
function Step({
  n,
  title,
  last = false,
  children,
}: {
  n: number;
  title: string;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <li className={`relative pl-14 ${last ? '' : 'pb-7'}`}>
      {!last && (
        <span aria-hidden="true" className="absolute top-11 bottom-1 left-[1.3rem] w-1 bg-line" />
      )}
      <span
        aria-hidden="true"
        className="absolute top-0 left-0 inline-flex size-11 items-center justify-center rounded-md border-2 border-line bg-accent font-heading text-xl font-bold text-on-accent"
      >
        {n}
      </span>
      <p className="pt-1.5 font-heading text-lg font-bold">{title}</p>
      <div className="mt-3">{children}</div>
    </li>
  );
}

function Tile({ icon, title, action }: { icon: ReactNode; title: string; action: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-md border-2 border-line bg-surface p-3 text-center">
      {icon}
      <span className="font-heading text-lg font-bold">{title}</span>
      <span className="text-sm">{action}</span>
    </div>
  );
}

/**
 * "How it works" as three numbered steps on a line (D-096): post the plate (lost: type it,
 * found: photograph it), we match the same number, you contact each other. Big type, ink
 * colours and one picture per step, so it reads at a glance.
 */
export function HowItWorks() {
  const t = useTranslations('home.how');

  return (
    <section aria-labelledby="how-title" className="mt-10 border-t-2 border-line-soft pt-6">
      <h2 id="how-title" className="text-xl font-bold">
        {t('title')}
      </h2>
      <ol className="mt-5">
        <Step n={1} title={t('step1')}>
          <div className="grid grid-cols-2 gap-3">
            <Tile icon={<LostPlateIcon size={40} />} title={t('lostTitle')} action={t('lostDo')} />
            <Tile icon={<CameraIcon size={40} />} title={t('foundTitle')} action={t('foundDo')} />
          </div>
        </Step>
        <Step n={2} title={t('step2')}>
          <div aria-hidden="true" className="relative inline-block">
            <PlateView plate={EXAMPLE} size="sm" />
            <span className="absolute -top-3 -right-3 inline-flex size-10 items-center justify-center rounded-full border-2 border-line bg-accent text-on-accent">
              <CheckIcon size={28} />
            </span>
          </div>
        </Step>
        <Step n={3} title={t('step3')} last>
          <p className="flex items-center gap-3">
            <span aria-hidden="true" className="flex shrink-0">
              <PhoneIcon size={36} />
              <PhoneIcon size={36} className="-ml-2" />
            </span>
            <span>{t('step3Do')}</span>
          </p>
        </Step>
      </ol>
    </section>
  );
}

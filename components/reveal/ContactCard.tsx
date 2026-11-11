'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { buttonClass } from '@/components/ui/Button';

/** LINE add-friend link: personal IDs use `~id`, official accounts start with `@`. */
export function lineUrl(id: string): string {
  return id.startsWith('@')
    ? `https://line.me/R/ti/p/${encodeURIComponent(id)}`
    : `https://line.me/ti/p/~${encodeURIComponent(id)}`;
}

function CopyButton({ value }: { value: string }) {
  const t = useTranslations('reveal');
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="min-h-11 px-2 text-sm font-semibold text-accent-ink underline decoration-2 underline-offset-4"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard blocked: the value is visible and selectable anyway.
        }
      }}
    >
      <span aria-live="polite">{copied ? t('copied') : t('copy')}</span>
    </button>
  );
}

const row = 'flex flex-wrap items-center justify-between gap-2 py-2';

/** Revealed contact details with one-tap actions (open LINE, call, email, copy). */
export function ContactCard({
  title,
  lineId,
  phone,
  email,
  children,
  reminder,
}: {
  title: string;
  lineId: string | null;
  phone: string | null;
  email: string | null;
  /** Extra details below the contacts (district, note, where the plate is). */
  children?: ReactNode;
  /** Safety line for the person reading it (owner and finder get different advice). */
  reminder: string;
}) {
  const t = useTranslations('reveal');
  return (
    <section
      aria-live="polite"
      className="space-y-2 rounded-md border-2 border-line bg-accent-soft p-4"
    >
      <h3 className="font-heading text-lg font-bold">{title}</h3>
      <dl className="divide-y-2 divide-line-soft">
        {lineId && (
          <div className={row}>
            <dt className="font-semibold">{t('line')}</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-lg">{lineId}</span>
              <CopyButton value={lineId} />
              <a
                href={lineUrl(lineId)}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass('secondary')}
              >
                {t('openLine')}
              </a>
            </dd>
          </div>
        )}
        {phone && (
          <div className={row}>
            <dt className="font-semibold">{t('phone')}</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-lg">{phone}</span>
              <CopyButton value={phone} />
              <a href={`tel:${phone}`} className={buttonClass('secondary')}>
                {t('call')}
              </a>
            </dd>
          </div>
        )}
        {email && (
          <div className={row}>
            <dt className="font-semibold">{t('email')}</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <span className="break-all">{email}</span>
              <a href={`mailto:${email}`} className={buttonClass('secondary')}>
                {t('sendEmail')}
              </a>
            </dd>
          </div>
        )}
      </dl>
      {children}
      <p className="font-semibold text-danger">{reminder}</p>
    </section>
  );
}

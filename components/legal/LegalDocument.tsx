import { getFormatter, getTranslations } from 'next-intl/server';
import { PageShell } from '@/components/site/PageShell';
import { Link } from '@/i18n/navigation';
import { POST_EXTEND_DAYS, POST_MAX_DAYS, POST_TTL_DAYS } from '@/lib/config/app';
import { brand } from '@/lib/config/brand';

/**
 * Date of the current Terms of Service and Privacy Policy. Change it with every edit to
 * either document. LEGAL-TODO(terms), LEGAL-TODO(data-controller): both are drafts awaiting
 * review by a Thai lawyer (docs/legal-todo.md).
 */
export const LEGAL_UPDATED = new Date('2026-10-30T00:00:00+07:00');

type Doc = 'terms' | 'privacy';

/** A formal document from the `legal.<doc>` messages: numbered sections of paragraphs. */
export async function LegalDocument({ doc }: { doc: Doc }) {
  const t = await getTranslations('legal');
  const format = await getFormatter();
  const vars = {
    brand: brand.name.en,
    operator: brand.author,
    email: brand.contactEmail,
    days: POST_TTL_DAYS,
    extendDays: POST_EXTEND_DAYS,
    maxDays: POST_MAX_DAYS,
  };

  // Sections and paragraphs are message objects walked by key, known only at runtime.
  const tAny = t as unknown as ((key: string, values?: typeof vars) => string) & {
    raw: (key: string) => unknown;
  };
  const sections = tAny.raw(`${doc}.sections`) as Record<
    string,
    { title: string; items: Record<string, string> }
  >;
  const other: Doc = doc === 'terms' ? 'privacy' : 'terms';

  return (
    <PageShell title={t(`${doc}.title`)}>
      <div className="space-y-6">
        <p className="text-sm text-ink-muted">
          {t('lastUpdated', { date: format.dateTime(LEGAL_UPDATED, { dateStyle: 'long' }) })}
        </p>
        <p>{tAny(`${doc}.intro`, vars)}</p>

        <nav aria-label={t('tocLabel')} className="rounded-md border-2 border-line-soft p-3">
          <ol className="space-y-1">
            {Object.keys(sections).map((s) => (
              <li key={s}>
                <a
                  href={`#${s}`}
                  className="inline-flex min-h-11 items-center underline underline-offset-4"
                >
                  {tAny(`${doc}.sections.${s}.title`)}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {Object.entries(sections).map(([s, section]) => (
          <section key={s} aria-labelledby={s} className="space-y-3">
            <h2 id={s} className="scroll-mt-4 pt-2 text-xl font-bold">
              {tAny(`${doc}.sections.${s}.title`)}
            </h2>
            {Object.keys(section.items).map((i) => (
              <p key={i}>{tAny(`${doc}.sections.${s}.items.${i}`, vars)}</p>
            ))}
          </section>
        ))}

        <div className="flex flex-col gap-1 border-t-2 border-line-soft pt-4">
          <a
            href={`mailto:${brand.contactEmail}`}
            className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
          >
            {t('contactLink')}
          </a>
          <Link
            href={`/${other}`}
            className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
          >
            {t(doc === 'terms' ? 'otherTerms' : 'otherPrivacy')}
          </Link>
        </div>
      </div>
    </PageShell>
  );
}

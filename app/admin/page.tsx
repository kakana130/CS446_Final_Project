import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { AdminLogout, AdminModeToggle, AdminPostActions } from '@/components/admin/AdminActions';
import { ADMIN_COOKIE, verifySessionToken } from '@/lib/admin/session';
import { brand } from '@/lib/config/brand';
import {
  adminAudit,
  adminFeedback,
  adminFindPosts,
  adminOverview,
  adminReportedPosts,
  adminReveals,
  type AdminPost,
} from '@/lib/db/admin';
import { signCropUrls } from '@/lib/db/storage';
import { provinceName } from '@/lib/plate/provinces';

const TABS = ['overview', 'reports', 'posts', 'feedback', 'logs'] as const;
type Tab = (typeof TABS)[number];

export const dynamic = 'force-dynamic';

/** Admin dashboard (D-080). Every visit re-checks the session cookie. */
export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string }>;
}) {
  if (!verifySessionToken((await cookies()).get(ADMIN_COOKIE)?.value)) redirect('/admin/login');
  const params = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(params.tab ?? '')
    ? (params.tab as Tab)
    : 'overview';
  const q = (params.q ?? '').slice(0, 20);
  const t = await getTranslations({ locale: 'th', namespace: 'admin' });
  const format = await getFormatter({ locale: 'th' });
  const when = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });

  const postList = async (posts: AdminPost[]) => {
    const urls = await signCropUrls(posts.flatMap((p) => (p.crop_path ? [p.crop_path] : [])));
    return (
      <ul className="space-y-3">
        {posts.map((p) => (
          <li key={p.post_id} className="space-y-2 rounded-md border-2 border-line bg-surface p-3">
            <div className="flex flex-wrap items-start gap-3">
              {p.crop_path && urls.get(p.crop_path) && (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                <img
                  src={urls.get(p.crop_path)}
                  alt={p.plate_display}
                  className="max-h-24 rounded-sm border-2 border-line-soft"
                />
              )}
              <div className="space-y-1">
                <p className="text-lg font-bold">
                  {p.plate_display}{' '}
                  <span className="text-base font-normal text-ink-muted">
                    {provinceName(p.province_code, 'th') ?? t('noProvince')}
                  </span>
                </p>
                <p className="text-sm">
                  {t(`kind.${p.kind}`)} · {t(`status.${p.status}`)} ·{' '}
                  {t('reportCount', { count: p.report_count })} · {when(p.created_at)}
                </p>
              </div>
            </div>
            {p.reports && p.reports.length > 0 && (
              <ul className="space-y-1 text-sm">
                {p.reports.map((r, i) => (
                  <li key={i}>
                    <span className="font-semibold">{t(`reasons.${r.reason}`)}</span>
                    {r.note && <> — {r.note}</>}{' '}
                    <span className="text-ink-muted">({when(r.createdAt)})</span>
                  </li>
                ))}
              </ul>
            )}
            <AdminPostActions postId={p.post_id} status={p.status} reported={p.report_count > 0} />
          </li>
        ))}
      </ul>
    );
  };

  let body: React.ReactNode;
  if (tab === 'overview') {
    const o = await adminOverview();
    const cards: [string, number][] = [
      [t('stats.lostActive'), o.lostActive],
      [t('stats.foundActive'), o.foundActive],
      [t('stats.matches'), o.matches],
      [t('stats.resolved'), o.resolved],
      [t('stats.reportedPosts'), o.reportedPosts],
      [t('stats.hidden'), o.hidden],
      [t('stats.needsReview'), o.needsReview],
      [t('stats.feedback'), o.feedback],
    ];
    body = (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {cards.map(([label, n]) => (
            <div key={label} className="rounded-md border-2 border-line bg-surface p-3">
              <p className="text-sm text-ink-muted">{label}</p>
              <p className="text-2xl font-bold">{n}</p>
            </div>
          ))}
        </div>
        <section className="space-y-2">
          <h2 className="text-lg font-bold">{t('siteMode')}</h2>
          <p>{o.mode === 'active' ? t('modeActive') : t('modeDormant')}</p>
          <AdminModeToggle mode={o.mode} />
        </section>
        <section className="space-y-2">
          <h2 className="text-lg font-bold">{t('daily')}</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th>{t('col.day')}</th>
                <th>{t('col.lost')}</th>
                <th>{t('col.found')}</th>
                <th>{t('col.matches')}</th>
                <th>{t('col.resolved')}</th>
              </tr>
            </thead>
            <tbody>
              {o.daily.map((d) => (
                <tr key={d.day} className="border-t border-line-soft">
                  <td>{d.day}</td>
                  <td>{d.lost_created}</td>
                  <td>{d.found_created}</td>
                  <td>{d.matches}</td>
                  <td>{d.resolved}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    );
  } else if (tab === 'reports') {
    const posts = await adminReportedPosts();
    body = posts.length ? await postList(posts) : <p>{t('noReports')}</p>;
  } else if (tab === 'posts') {
    const posts = await adminFindPosts(q);
    body = (
      <div className="space-y-4">
        <form method="get" className="flex gap-2">
          <input type="hidden" name="tab" value="posts" />
          <input
            name="q"
            defaultValue={q}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
            className="min-h-11 flex-1 rounded-md border-2 border-line bg-surface px-3"
          />
          <button
            type="submit"
            className="min-h-11 rounded-md border-2 border-line bg-accent px-4 font-bold text-on-accent"
          >
            {t('search')}
          </button>
        </form>
        {posts.length ? await postList(posts) : <p>{t('noPosts')}</p>}
      </div>
    );
  } else if (tab === 'feedback') {
    const rows = await adminFeedback();
    body = rows.length ? (
      <ul className="space-y-3">
        {rows.map((f) => (
          <li key={f.id} className="rounded-md border-2 border-line bg-surface p-3">
            <p className="font-bold">
              {t('rating', { count: f.rating })}{' '}
              <span className="text-sm font-normal text-ink-muted">
                {t(`context.${f.context}`)} · {f.locale} · {when(f.created_at)}
              </span>
            </p>
            {f.comment && <p className="mt-1 whitespace-pre-wrap">{f.comment}</p>}
          </li>
        ))}
      </ul>
    ) : (
      <p>{t('noFeedback')}</p>
    );
  } else {
    const [audit, reveals] = await Promise.all([adminAudit(), adminReveals()]);
    body = (
      <div className="space-y-6">
        <section className="space-y-2">
          <h2 className="text-lg font-bold">{t('auditLog')}</h2>
          <table className="w-full text-sm">
            <tbody>
              {audit.map((a) => (
                <tr key={a.id} className="border-t border-line-soft align-top">
                  <td className="py-1 pe-3 whitespace-nowrap">{when(a.created_at)}</td>
                  <td className="py-1 pe-3 font-semibold">{a.action}</td>
                  <td className="py-1 break-all text-ink-muted">
                    {a.target_id ?? ''} {JSON.stringify(a.details)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="space-y-2">
          <h2 className="text-lg font-bold">{t('revealLog')}</h2>
          <p className="text-sm text-ink-muted">{t('revealLogHint')}</p>
          <table className="w-full text-sm">
            <tbody>
              {reveals.map((r) => (
                <tr key={r.id} className="border-t border-line-soft">
                  <td className="py-1 pe-3 whitespace-nowrap">{when(r.created_at)}</td>
                  <td className="py-1 pe-3 font-semibold">{r.plate_display}</td>
                  <td className="py-1 font-mono text-ink-muted">{r.ip_prefix}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{t('title', { brand: brand.name.en })}</h1>
        <AdminLogout />
      </header>
      <nav className="flex flex-wrap gap-2" aria-label={t('tabsLabel')}>
        {TABS.map((k) => (
          <Link
            key={k}
            href={`/admin?tab=${k}`}
            aria-current={k === tab ? 'page' : undefined}
            className={`min-h-11 rounded-full border-2 px-4 py-2 text-sm font-semibold ${
              k === tab ? 'border-line bg-accent-soft' : 'border-line-soft bg-surface'
            }`}
          >
            {t(`tabs.${k}`)}
          </Link>
        ))}
      </nav>
      {body}
    </div>
  );
}

import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ArrowRightIcon, PostsIcon, CameraIcon, LostPlateIcon } from '@/components/icons';
import { HomeAccountHint } from '@/components/auth/HomeAccountHint';
import { HowItWorks } from '@/components/home/HowItWorks';
import { Phrased } from '@/components/ui/Phrased';
import { actionTile, bigLink } from '@/components/ui/styles';
import { Link } from '@/i18n/navigation';

function ActionTile({
  href,
  icon,
  title,
  hint,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <Link href={href} className={actionTile}>
      <span className="text-ink">{icon}</span>
      <span className="font-heading text-xl font-bold">{title}</span>
      <span className="text-sm text-ink-muted">{hint}</span>
    </Link>
  );
}

export default async function HomePage() {
  const t = await getTranslations('home');

  return (
    <div className="mx-auto max-w-2xl px-4 pt-6 pb-12">
      <h1 className="text-2xl font-bold">
        <Phrased text={t('title')} />
      </h1>
      <p className="mt-2 text-ink-muted">{t('lead')}</p>

      <nav aria-label={t('actionsLabel')} className="mt-6 grid grid-cols-2 gap-3">
        <ActionTile
          href="/lost"
          icon={<LostPlateIcon size={40} />}
          title={t('lost.title')}
          hint={t('lost.hint')}
        />
        <ActionTile
          href="/found"
          icon={<CameraIcon size={40} />}
          title={t('found.title')}
          hint={t('found.hint')}
        />
      </nav>

      {/* Searching a plate is the first step of "I lost a plate" (D-101). */}
      <Link href="/my-posts" className={`${bigLink} mt-4`}>
        <PostsIcon size={28} />
        <span className="flex-1">{t('myPosts')}</span>
        <ArrowRightIcon size={24} />
      </Link>
      <HomeAccountHint />

      <HowItWorks />
    </div>
  );
}

import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';

/** Managing with plate + PIN is gone (D-085): old links land on "My posts". */
export default async function ManagePage() {
  redirect({ href: '/my-posts', locale: await getLocale() });
}

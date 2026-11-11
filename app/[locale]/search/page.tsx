import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';

/** Searching a plate is the first step of "I lost a plate" now (D-101); old links land there. */
export default async function SearchPage() {
  redirect({ href: '/lost', locale: await getLocale() });
}

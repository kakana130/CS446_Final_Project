import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { brand } from '@/lib/config/brand';
import messages from '@/messages/th.json';
import { bodyFace, headingFace } from '../fonts';
import '../globals.css';

// The admin area (D-080) sits outside the locale routes, always in Thai, never indexed.
export const metadata: Metadata = {
  title: `${brand.name.en} admin`,
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={`${bodyFace.variable} ${headingFace.variable}`} data-theme="light">
      <body className="min-h-dvh antialiased">
        <NextIntlClientProvider locale="th" messages={messages} timeZone="Asia/Bangkok">
          <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import en from '@/messages/en.json';
import th from '@/messages/th.json';
import './globals.css';

// Rendered for URLs that match no route at all (outside any locale layout), so it cannot use
// next-intl; it shows both languages straight from the message files instead.
export const metadata: Metadata = {
  title: `${th.notFound.title} · ${en.notFound.title}`,
};

export default function GlobalNotFound() {
  return (
    <html lang="th">
      <body className="flex min-h-dvh items-center">
        <main className="mx-auto max-w-2xl space-y-8 px-4 py-12">
          <section>
            <h1 className="text-2xl font-bold">{th.notFound.title}</h1>
            <p className="mt-2 text-ink-muted">{th.notFound.body}</p>
            <Link
              href="/"
              className="mt-4 inline-flex min-h-11 items-center font-semibold text-accent-ink underline decoration-2 underline-offset-4"
            >
              {th.notFound.home}
            </Link>
          </section>
          <section lang="en">
            <h2 className="text-xl font-bold">{en.notFound.title}</h2>
            <p className="mt-2 text-ink-muted">{en.notFound.body}</p>
            <Link
              href="/en"
              className="mt-4 inline-flex min-h-11 items-center font-semibold text-accent-ink underline decoration-2 underline-offset-4"
            >
              {en.notFound.home}
            </Link>
          </section>
        </main>
      </body>
    </html>
  );
}

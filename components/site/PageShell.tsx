import type { ReactNode } from 'react';
import { Phrased } from '@/components/ui/Phrased';

/** Standard page column with a heading that wraps between Thai phrases. */
export function PageShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl px-4 pt-6 pb-16">
      <h1 className="mb-4 text-2xl font-bold">
        <Phrased text={title} />
      </h1>
      {children}
    </div>
  );
}

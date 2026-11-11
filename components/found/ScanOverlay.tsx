import { Spinner } from '@/components/ui/Button';

/**
 * Laid over the photo while plates are being looked for (D-098): a dimmed photo, a line
 * sweeping over it like a scanner, and what is happening in the middle, so nobody wonders
 * whether the page is stuck. It lets taps through, so a box can still be drawn by hand.
 */
export function ScanOverlay({ text, detail }: { text: string; detail?: string | null }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 bg-[rgb(0_0_0/0.35)]">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-1/2 h-1 bg-accent shadow-[0_0_16px_4px_var(--color-accent)] motion-safe:animate-scan"
      />
      <div className="absolute inset-x-0 bottom-0 flex justify-center p-3">
        <p
          role="status"
          className="flex flex-col items-center gap-1 rounded-md border-2 border-line bg-surface/95 px-3 py-1.5 text-center text-sm font-semibold text-ink shadow-sign"
        >
          <span className="inline-flex items-center gap-2">
            <Spinner /> {text}
          </span>
          {detail && <span className="font-normal text-ink-muted">{detail}</span>}
        </p>
      </div>
    </div>
  );
}

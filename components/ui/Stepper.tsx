/** "Step 2 of 3" with a segmented bar. The text is the accessible part; the bar is decorative. */
export function Stepper({
  current,
  total,
  label,
}: {
  current: number;
  total: number;
  label: string;
}) {
  return (
    <div className="mb-5">
      <p className="text-sm font-semibold text-ink-muted" aria-live="polite">
        {label}
      </p>
      <div aria-hidden="true" className="mt-1.5 flex gap-1.5">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={`h-1.5 flex-1 rounded-sm ${i < current ? 'bg-accent' : 'bg-line-soft'}`}
          />
        ))}
      </div>
    </div>
  );
}

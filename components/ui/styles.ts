/**
 * Shared class recipes. Kept as plain strings (no runtime dependency) so server and client
 * components can both use them.
 */

/** Compact bordered control used in the site header. Meets the 44×44 px touch target. */
export const headerControl =
  'inline-flex min-h-11 min-w-11 items-center justify-center whitespace-nowrap rounded-sm ' +
  'border-2 border-line bg-surface px-2.5 text-sm font-semibold text-ink hover:bg-surface-sunk';

/** Large signage-style tile used for the two primary actions on the home page. */
export const actionTile =
  'group flex min-h-44 flex-col gap-2 rounded-md border-2 border-line bg-surface p-4 text-ink ' +
  'shadow-sign transition-[transform,box-shadow] duration-100 hover:bg-surface-sunk ' +
  'active:translate-y-0.5 active:shadow-sign-pressed';

/** Inline text link with a thick, readable underline. */
export const textLink =
  'font-semibold text-accent-ink underline decoration-2 underline-offset-4 hover:text-ink';

/**
 * Full-width link to “My posts” on the home page: tinted amber, so it reads as a different
 * kind of place from the two white action tiles above it (D-101).
 */
export const bigLink =
  'flex min-h-16 w-full items-center gap-3 rounded-md border-2 border-line bg-accent-soft px-4 ' +
  'font-heading text-lg font-bold text-ink shadow-sign transition-[transform,box-shadow] ' +
  'duration-100 hover:bg-surface active:translate-y-0.5 active:shadow-sign-pressed';

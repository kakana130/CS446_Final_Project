import { Noto_Sans_Thai_Looped } from 'next/font/google';

/**
 * Real Thai plates use a condensed, looped typeface. Noto Sans Thai Looped has a width axis
 * (62.5–100), so the plate can be condensed with `font-stretch` without a second font file.
 * Loaded only where a plate is rendered.
 */
export const plateFont = Noto_Sans_Thai_Looped({
  subsets: ['thai', 'latin'],
  axes: ['wdth'],
  variable: '--font-plate-face',
  display: 'swap',
});

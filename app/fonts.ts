import { IBM_Plex_Sans_Thai, IBM_Plex_Sans_Thai_Looped } from 'next/font/google';

// Looped letterforms for running text: easier for older Thai readers at small sizes.
export const bodyFace = IBM_Plex_Sans_Thai_Looped({
  subsets: ['thai', 'latin'],
  weight: ['400', '600'],
  variable: '--font-body-face',
  display: 'swap',
});

// Loopless for headings and labels: the calm, signage-like civic voice.
export const headingFace = IBM_Plex_Sans_Thai({
  subsets: ['thai', 'latin'],
  weight: ['700'],
  variable: '--font-heading-face',
  display: 'swap',
});

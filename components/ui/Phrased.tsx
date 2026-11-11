import { Fragment } from 'react';

/**
 * Thai puts spaces between phrases, not words, and browsers break Thai lines at dictionary
 * word boundaries (CSS `word-break: keep-all` is ignored for Thai). For short display text
 * such as headings, wrapping each phrase in an inline-block makes lines break only at the
 * spaces the writer chose. A phrase wider than the line still wraps inside its box.
 */
export function Phrased({ text }: { text: string }) {
  const phrases = text.split(' ').filter(Boolean);
  return phrases.map((phrase, i) => (
    <Fragment key={i}>
      {i > 0 && ' '}
      <span className="inline-block max-w-full">{phrase}</span>
    </Fragment>
  ));
}

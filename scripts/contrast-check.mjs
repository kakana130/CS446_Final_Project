// Verifies WCAG 2.2 contrast for the design tokens in app/globals.css, for both themes.
// Usage: node scripts/contrast-check.mjs   (exits non-zero on any failure)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

export function readTheme(source, name) {
  const start = source.indexOf(`/* tokens:${name} */`);
  if (start < 0) throw new Error(`missing /* tokens:${name} */ block`);
  const open = source.indexOf('{', start);
  const close = source.indexOf('}', open);
  const vars = {};
  for (const m of source
    .slice(open + 1, close)
    .matchAll(/--p-([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    vars[m[1]] = m[2];
  }
  return vars;
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// [foreground, background, minimum ratio, why]
const PAIRS = [
  ['ink', 'bg', 7, 'body text (AAA)'],
  ['ink', 'surface', 7, 'body text on cards (AAA)'],
  ['ink', 'surface-sunk', 7, 'text on sunken areas'],
  ['ink-muted', 'bg', 4.5, 'secondary text'],
  ['ink-muted', 'surface', 4.5, 'secondary text on cards'],
  ['accent-ink', 'bg', 4.5, 'links / accent text'],
  ['accent-ink', 'surface', 4.5, 'links on cards'],
  ['on-accent', 'accent', 7, 'primary button label'],
  ['ink', 'accent-soft', 7, 'text on accent highlight'],
  ['success', 'bg', 4.5, 'success text'],
  ['success', 'surface', 4.5, 'success text on cards'],
  ['danger', 'bg', 4.5, 'error text'],
  ['danger', 'surface', 4.5, 'error text on cards'],
  ['line', 'bg', 3, 'borders of controls (non-text)'],
  ['line', 'surface', 3, 'borders of controls on cards'],
  ['focus', 'bg', 3, 'focus ring'],
  ['focus', 'surface', 3, 'focus ring on cards'],
  ['plate-ink', 'plate', 7, 'plate characters'],
];

export function check(theme, vars) {
  const failures = [];
  const results = [];
  for (const [fg, bg, min, why] of PAIRS) {
    if (!vars[fg] || !vars[bg]) {
      failures.push(`${theme}: missing token --p-${fg} or --p-${bg}`);
      continue;
    }
    const ratio = contrast(vars[fg], vars[bg]);
    results.push({ theme, pair: `${fg} on ${bg}`, ratio: ratio.toFixed(2), min, why });
    if (ratio < min)
      failures.push(`${theme}: ${fg} on ${bg} = ${ratio.toFixed(2)} < ${min} (${why})`);
  }
  return { failures, results };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let failed = [];
  for (const theme of ['light', 'dark']) {
    const { failures, results } = check(theme, readTheme(css, theme));
    console.table(results);
    failed = failed.concat(failures);
  }
  if (failed.length) {
    console.error(failed.join('\n'));
    process.exit(1);
  }
  console.log('All contrast checks passed.');
}

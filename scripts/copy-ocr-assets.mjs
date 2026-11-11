// Copy the Tesseract.js worker and WASM cores from node_modules into public/tesseract so they
// are served from our own origin (CSP: no third-party script hosts). Runs before dev/build.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const out = join('public', 'tesseract');
mkdirSync(join(out, 'core'), { recursive: true });

copyFileSync(
  join('node_modules', 'tesseract.js', 'dist', 'worker.min.js'),
  join(out, 'worker.min.js'),
);

// LSTM-only cores (we never use the legacy engine); tesseract.js picks the SIMD variant the
// browser supports and downloads only that one.
const coreDir = join('node_modules', 'tesseract.js-core');
const cores = readdirSync(coreDir).filter((f) => /-lstm(\.wasm)?\.js$/.test(f));
for (const f of cores) copyFileSync(join(coreDir, f), join(out, 'core', f));
console.log(`copied OCR worker + ${cores.length} core files to ${out}`);

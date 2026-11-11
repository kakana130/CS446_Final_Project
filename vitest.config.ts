import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const alias = {
  '@': fileURLToPath(new URL('.', import.meta.url)),
  'server-only': fileURLToPath(new URL('./test/server-only-stub.ts', import.meta.url)),
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          include: [
            'lib/**/*.test.ts',
            'components/**/*.test.{ts,tsx}',
            'scripts/**/*.test.ts',
            'eslint-rules/**/*.test.ts',
            'messages/**/*.test.ts',
          ],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'db',
          environment: 'node',
          include: ['supabase/tests/**/*.test.ts'],
          // Test files share fixture ids; against a real database they must not interleave.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          setupFiles: ['tests/integration/setup.ts'],
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.ts'],
      exclude: ['**/*.test.ts'],
      // The plate module and matching engine are the core of the product: keep them near-fully tested.
      thresholds: {
        'lib/plate/**': { lines: 95, functions: 95, branches: 90, statements: 95 },
        'lib/matching/**': { lines: 95, functions: 95, branches: 90, statements: 95 },
      },
    },
  },
});

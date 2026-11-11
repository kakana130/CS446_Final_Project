import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import local from './eslint-rules/no-server-env-in-client.js';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    plugins: { local },
    rules: {
      'local/no-server-env-in-client': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // All user-facing copy goes through next-intl message files. Punctuation-only text is fine.
    files: ['app/**/*.tsx', 'components/**/*.tsx'],
    rules: {
      'react/jsx-no-literals': [
        'error',
        {
          noStrings: false,
          ignoreProps: true,
          allowedStrings: ['·', '—', '→', '/', ':', '?', '(', ')', '*'],
        },
      ],
    },
  },
  {
    // The secret-key client bypasses RLS: only narrow data-access modules may touch it.
    files: ['**/*.{ts,tsx}'],
    ignores: ['lib/db/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/lib/db/server', '**/lib/db/server'],
              message:
                'Use a data-access function from lib/db/* instead of the raw service client.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['scripts/**/*.mjs', 'eslint-rules/**/*.js', 'aws/lambda/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'coverage/**',
    'next-env.d.ts',
    'supabase/.temp/**',
    'public/tesseract/**',
  ]),
]);

export default eslintConfig;

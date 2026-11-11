import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import plugin from './no-server-env-in-client.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } });

tester.run('no-server-env-in-client', plugin.rules['no-server-env-in-client'], {
  valid: [
    { code: `'use client'; const a = process.env.NEXT_PUBLIC_SUPABASE_URL;` },
    { code: `'use client'; const dev = process.env.NODE_ENV === 'development';` },
    // Server files may read anything.
    { code: `const key = process.env.SUPABASE_SECRET_KEY;` },
    { code: `import 'server-only'; const { CRON_SECRET } = process.env;` },
  ],
  invalid: [
    {
      code: `'use client'; const key = process.env.SUPABASE_SECRET_KEY;`,
      errors: [{ messageId: 'serverEnv' }],
    },
    {
      code: `'use client'; const key = process.env['VAPID_PRIVATE_KEY'];`,
      errors: [{ messageId: 'serverEnv' }],
    },
    {
      code: `'use client'; const name = 'X'; const v = process.env[name];`,
      errors: [{ messageId: 'serverEnv' }],
    },
    {
      code: `'use client'; const { CRON_SECRET } = process.env;`,
      errors: [{ messageId: 'wholeEnv' }],
    },
  ],
});

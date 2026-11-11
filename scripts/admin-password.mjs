// Generate the admin credentials for .env.local / Vercel (D-080).
//   npm run admin:password
// Asks for the password without echoing it, prints an argon2id hash and a fresh session
// secret. The password itself is never stored anywhere.
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { hash } from '@node-rs/argon2';

function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.startsWith(question)) process.stdout.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

const password = process.env.ADMIN_PASSWORD_INPUT ?? (await ask('Admin password: '));
if (password.length < 12) {
  console.error('Use at least 12 characters.');
  process.exit(1);
}
const passwordHash = await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
const secret = randomBytes(32).toString('hex');

console.log('\n# .env.local ($ must be escaped there):');
console.log(`ADMIN_PASSWORD_HASH=${passwordHash.split('$').join('\\$')}`);
console.log(`ADMIN_SESSION_SECRET=${secret}`);
console.log('\n# Vercel environment variables (paste as is):');
console.log(`ADMIN_PASSWORD_HASH=${passwordHash}`);
console.log(`ADMIN_SESSION_SECRET=${secret}`);

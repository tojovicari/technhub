import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(__dirname, '../prisma/schema.prisma');

console.log('[migrate] Running prisma migrate deploy...');

execSync(`npx prisma migrate deploy --schema=${schemaPath}`, {
  stdio: 'inherit',
  cwd: resolve(__dirname, '..'),
});

console.log('[migrate] Done.');

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(root, 'scripts/check-design-tokens.mjs');

// Read script, replace process.exit with process.exitCode =
let src = readFileSync(scriptPath, 'utf8');
const patched = src
  .replace(/process\.exit\(1\)/g, 'process.exitCode = 1')
  .replace(/process\.exit\(0\)/g, 'process.exitCode = 0');

const tmpPath = join(root, 'scripts/_tmp_patched.mjs');
import { writeFileSync, unlinkSync } from 'node:fs';
writeFileSync(tmpPath, patched);

try {
  const result = execSync(`node ${tmpPath}`, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  console.log('STDOUT:', result);
} catch (e) {
  console.log('EXIT CODE:', e.status);
  console.log('STDOUT:', e.stdout);
  console.log('STDERR:', e.stderr);
} finally {
  unlinkSync(tmpPath);
}

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

try {
  const stdout = execSync('node scripts/check-design-tokens.mjs', {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 25000,
  });
  writeFileSync('check-stdout.txt', stdout);
  writeFileSync('check-stderr.txt', '');
  console.log('SUCCESS: exit 0, stdout length:', stdout.length);
} catch (e) {
  writeFileSync('check-stdout.txt', e.stdout || '');
  writeFileSync('check-stderr.txt', e.stderr || '');
  console.log('VIOLATIONS: exit', e.status, 'stdout length:', (e.stdout || '').length, 'stderr length:', (e.stderr || '').length);
}

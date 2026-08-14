// Fresh process: run check-design-tokens.mjs as a child and capture output
import { spawnSync } from 'node:child_process';

console.log('Starting child process...');
const start = Date.now();
const result = spawnSync('node', ['scripts/check-design-tokens.mjs'], {
  encoding: 'utf8',
  timeout: 15000,
  stdio: ['ignore', 'pipe', 'pipe'],
});
console.log(`Child finished in ${Date.now() - start}ms`);
console.log('Status:', result.status);
console.log('Signal:', result.signal);
console.log('stdout length:', (result.stdout || '').length);
console.log('stderr length:', (result.stderr || '').length);
if (result.stderr) {
  console.log('stderr first 2000 chars:', result.stderr.substring(0, 2000));
}
if (result.stdout) {
  console.log('stdout first 500 chars:', result.stdout.substring(0, 500));
}

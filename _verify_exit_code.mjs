import { spawnSync } from 'node:child_process';
const result = spawnSync('node', ['scripts/check-design-tokens.mjs'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  timeout: 30000,
});
console.log('Exit code:', result.status);
console.log('Signal:', result.signal);
// Check that both new rules appear in the output
const stderr = result.stderr || '';
const hasRule9 = stderr.includes('硬编码颜色');
const hasRgbaViolation = stderr.includes('rgba(0,0,0,0.4)');
console.log('Rule 9 detected (硬编码颜色):', hasRule9);
console.log('RGBA violation found:', hasRgbaViolation);
console.log('Total violation count line:', stderr.match(/\u2716 (\d+)/)?.[1] || 'not found');

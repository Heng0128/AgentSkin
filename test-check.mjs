import { spawnSync } from 'node:child_process';
const result = spawnSync('node', ['scripts/check-design-tokens.mjs'], {
  encoding: 'utf8',
  cwd: process.cwd(),
});
console.log('stdout:', JSON.stringify(result.stdout));
console.log('stderr:', JSON.stringify(result.stderr));
console.log('exit:', result.status);

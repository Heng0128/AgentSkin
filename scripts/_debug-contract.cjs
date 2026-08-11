// Wrapper to capture all output from check-injection-contract.mjs
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.dirname(__dirname);
const scriptPath = path.join(root, 'scripts', 'check-injection-contract.mjs');

const result = spawnSync('node', [scriptPath], {
  encoding: 'utf8',
  cwd: root,
  env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
});

console.log('=== STDOUT ===');
console.log(result.stdout || '(empty)');
console.log('=== STDERR ===');
console.log(result.stderr || '(empty)');
console.log('=== EXIT CODE ===');
console.log(result.status);

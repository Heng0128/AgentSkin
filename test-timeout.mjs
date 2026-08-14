import { spawn } from 'node:child_process';

const child = spawn('node', ['scripts/check-design-tokens.mjs'], { stdio: 'pipe' });
let out = '';
let err = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (err += d));

const timer = setTimeout(() => {
  child.kill();
  console.log('TIMEOUT after 20s');
  console.log('stdout:', out.substring(0, 3000));
  console.log('stderr:', err.substring(0, 3000));
  process.exit(1);
}, 20000);

child.on('exit', (code) => {
  clearTimeout(timer);
  console.log('EXIT:', code);
  console.log('stdout:', out.substring(0, 3000));
  console.log('stderr:', err.substring(0, 3000));
});

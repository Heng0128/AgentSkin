import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';

const stdoutFile = createWriteStream('child-stdout.txt');
const stderrFile = createWriteStream('child-stderr.txt');

const start = Date.now();
const child = spawn('node', ['scripts/check-design-tokens.mjs'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.stdout.pipe(stdoutFile);
child.stderr.pipe(stderrFile);

child.on('exit', (code) => {
  const elapsed = Date.now() - start;
  console.log(`EXIT: ${code} after ${elapsed}ms`);
  import('node:fs').then((fs) => {
    const stdout = fs.readFileSync('child-stdout.txt', 'utf8');
    const stderr = fs.readFileSync('child-stderr.txt', 'utf8');
    console.log('stdout length:', stdout.length);
    console.log('stderr length:', stderr.length);
    if (stderr.length > 0) {
      console.log('stderr preview:', stderr.substring(0, 2000));
    }
    if (stdout.length > 0) {
      console.log('stdout preview:', stdout.substring(0, 2000));
    }
  });
});

// Timeout safety
setTimeout(() => {
  if (!child.killed) {
    child.kill();
    console.log('KILLED after timeout');
  }
}, 25000);

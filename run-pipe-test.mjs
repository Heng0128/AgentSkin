import { spawn } from 'node:child_process';

// Test: spawn a simple node command that produces output
const child = spawn('node', ['-e', 'console.error("test stderr"); console.log("test stdout"); process.exitCode = 1;'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
child.stdout.on('data', (d) => (stdout += d));
child.stderr.on('data', (d) => (stderr += d));

child.on('exit', (code) => {
  console.log('Test exit:', code);
  console.log('stdout:', JSON.stringify(stdout));
  console.log('stderr:', JSON.stringify(stderr));
});

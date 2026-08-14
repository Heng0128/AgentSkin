// Wrapper that intercepts process.exit to capture output
const originalExit = process.exit;
let exitCode = 0;
process.exit = (code) => { exitCode = code; throw new Error(`__EXIT_${code}__`); };

const originalConsoleError = console.error;
const originalConsoleLog = console.log;
const captured = [];
console.error = (...args) => { captured.push(['stderr', ...args]); };
console.log = (...args) => { captured.push(['stdout', ...args]); };

try {
  await import('./scripts/check-design-tokens.mjs');
} catch (e) {
  if (!e.message.startsWith('__EXIT_')) {
    captured.push(['error', e.message]);
  }
}

// Restore and output
process.exit = originalExit;
console.error = originalConsoleError;
console.log = originalConsoleLog;

for (const [type, ...args] of captured) {
  if (type === 'stderr') console.error(...args);
  else console.log(...args);
}

console.log(`\n(Script would have exited with code ${exitCode})`);

// Import the real script but override process.exit to capture output
const originalExit = process.exit;
let wouldBeExitCode = 0;
process.exit = (code) => {
  wouldBeExitCode = code;
  throw new Error(`__EXIT_CODE_${code}__`);
};

// Capture stderr (where violations are printed)
const origErr = console.error;
const captured = [];
console.error = (...args) => {
  captured.push(args.join(' '));
  origErr(...args);
};

let completed = false;
try {
  await import('./scripts/check-design-tokens.mjs');
  completed = true;
} catch (e) {
  if (!e.message.startsWith('__EXIT_CODE_')) {
    console.log('REAL ERROR:', e.message);
  }
}

process.exit = originalExit;
console.error = origErr;

console.log('Script completed:', completed);
console.log('Would exit with:', wouldBeExitCode);
console.log('Captured stderr lines:', captured.length);
if (captured.length > 0) {
  console.log('\n--- First 30 violations ---');
  for (const line of captured.slice(0, 60)) {
    console.log(line);
  }
}

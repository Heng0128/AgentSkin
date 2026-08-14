import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(root, 'scripts/check-design-tokens.mjs');

// Read script, replace process.exit with process.exitCode =
let src = readFileSync(scriptPath, 'utf8');
const patched = src
  .replace(/process\.exit\(1\)/g, 'process.exitCode = 1')
  .replace(/process\.exit\(0\)/g, 'process.exitCode = 0');

// Write to temp file in same dir as original script (so `..` resolves correctly)
const tmpPath = join(root, 'scripts/_tmp_patched.mjs');
writeFileSync(tmpPath, patched);

// Import the patched module using file:// URL
const fileUrl = pathToFileURL(tmpPath).href;
await import(fileUrl);

console.log(`\n(Script exitCode: ${process.exitCode || 0})`);

// Cleanup
unlinkSync(tmpPath);

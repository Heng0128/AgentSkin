import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '.');
const UI_DIR = join(root, 'src/ui');

console.log('root:', root);
console.log('UI_DIR:', UI_DIR);

// read one file manually
const testFile = join(UI_DIR, 'App.tsx');
try {
  const content = readFileSync(testFile, 'utf8');
  console.log('App.tsx length:', content.length);
} catch (e) {
  console.log('App.tsx error:', e.message);
}

// Check if the script itself imports correctly
try {
  const mod = await import('./scripts/check-design-tokens.mjs');
  console.log('Module imported');
} catch (e) {
  console.log('Import error:', e.message);
}

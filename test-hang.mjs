import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '.');
const UI_DIR = join(root, 'src/ui');
const IGNORED_DIRS = new Set(['node_modules', 'out', '.git', '.build-tmp', 'dist', 'assets']);

let checked = 0;
let hangThreshold = 5000; // report if any file takes > 5s

function walkDir(dir, callback) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && IGNORED_DIRS.has(entry.name)) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      walkDir(fullPath, callback);
    } else if (entry.isFile()) {
      callback(fullPath, entry.name);
    }
  }
}

walkDir(UI_DIR, (filePath, fileName) => {
  if (!fileName.endsWith('.ts') && !fileName.endsWith('.tsx')) return;
  if (fileName.endsWith('.test.ts') || fileName.endsWith('.test.tsx')) return;

  checked++;
  const start = Date.now();
  const src = readFileSync(filePath, 'utf8');
  const lines = src.split('\n');
  const relPath = relative(root, filePath).replace(/\\/g, '/');
  const readMs = Date.now() - start;

  // Scan with new rules
  const scanStart = Date.now();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Simple regex test
    if (line.includes('rgba(') || line.includes('hsla(')) {
      // noop
    }
  }
  const scanMs = Date.now() - scanStart;

  if (readMs + scanMs > 100) {
    console.log(`SLOW: ${relPath} - read: ${readMs}ms, scan: ${scanMs}ms, lines: ${lines.length}, size: ${src.length}`);
  }

  if (checked % 20 === 0) {
    console.log(`Progress: ${checked} files checked...`);
  }
});

console.log(`Done: ${checked} files checked`);

import { readFileSync } from 'node:fs';

const inlineSpacingRe = /((?:margin|padding|gap|top|bottom|left|right|width|height)[A-Z]?[a-z]*|margin-[a-z]+|padding-[a-z]+):\s*(\d+(?:\.\d+)?)(px)?/g;

// Find ALL .ts/.tsx files and test every non-comment line
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '.');
const UI_DIR = join(root, 'src/ui');
const IGNORED_DIRS = new Set(['node_modules', 'out', '.git', '.build-tmp', 'dist', 'assets']);

let maxTime = 0;
let maxLine = '';
let maxFile = '';

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

  const src = readFileSync(filePath, 'utf8');
  const lines = src.split('\n');
  const relPath = relative(root, filePath).replace(/\\/g, '/');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;

    inlineSpacingRe.lastIndex = 0;
    const start = Date.now();
    let m, count = 0;
    while ((m = inlineSpacingRe.exec(line)) !== null && count < 200) { count++; }
    const elapsed = Date.now() - start;
    if (elapsed > maxTime) {
      maxTime = elapsed;
      maxLine = line.substring(0, 200);
      maxFile = `${relPath}:${i+1}`;
    }
  }
});

console.log(`Max time: ${maxTime}ms in ${maxFile}`);
console.log(`Line: ${maxLine}`);

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

console.log('1. imports done');
const root = join(dirname(fileURLToPath(import.meta.url)), '.');
const UI_DIR = join(root, 'src/ui');
console.log('2. root:', root, 'UI_DIR:', UI_DIR);

const IGNORED_DIRS = new Set(['node_modules', 'out', '.git', '.build-tmp', 'dist', 'assets']);
console.log('3. constants set');

function fileExists(absPath) {
  try { return statSync(absPath).isDirectory(); } catch { return false; }
}

console.log('4. fileExists defined. UI_DIR exists:', fileExists(UI_DIR));

if (!fileExists(UI_DIR)) {
  console.log('⊘ src/ui/ not found — skipping');
  process.exit(0);
}

console.log('5. about to walkDir...');

let fileCount = 0;
let dirCount = 0;

function walkDir(dir, callback) {
  dirCount++;
  if (dirCount % 10 === 0) console.log(`  walking dir #${dirCount}: ${dir}`);
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch (e) { console.log('  ERROR reading dir:', dir, e.message); return; }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && IGNORED_DIRS.has(entry.name)) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      walkDir(fullPath, callback);
    } else if (entry.isFile()) {
      fileCount++;
      callback(fullPath, entry.name);
    }
  }
}

walkDir(UI_DIR, (filePath, fileName) => {
  if (!fileName.endsWith('.ts') && !fileName.endsWith('.tsx')) return;
  if (fileName.endsWith('.test.ts') || fileName.endsWith('.test.tsx')) return;
  // Just read the file, don't process
  readFileSync(filePath, 'utf8');
});

console.log(`6. Done. ${dirCount} dirs, ${fileCount} files`);

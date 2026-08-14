import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '.');
const UI_DIR = join(root, 'src/ui');
const IGNORED_DIRS = new Set(['node_modules', 'out', '.git', '.build-tmp', 'dist', 'assets']);

const HARD_COLOR_RE = /(rgba?|hsla?)\((\d+(\.\d+)?\s*,\s*){2,3}(\d+(\.\d+)?)\)/g;
const INLINE_SHADOW_RE = /(?:box-shadow|boxShadow):\s*([^;}\n]+)/g;

function isWhitelistedHardColor(line, match, matchIndex, relPath) {
  if (/rgba?\(\s*var\(--/.test(match)) return true;
  const before = line.substring(0, matchIndex);
  if (/\bvar\([^)]*,\s*$/.test(before)) return true;
  if (relPath.startsWith('engines/')) return true;
  if (relPath.includes('RealDomPreview') && /shadow|case/.test(line)) return true;
  return false;
}

function isWhitelistedShadow(value) {
  if (value === 'none') return true;
  if (/var\(--shadow-float/.test(value)) return true;
  if (/var\(--shadow/.test(value)) return true;
  return false;
}

let violations = [];
let checkedFiles = 0;

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
  checkedFiles++;
  const src = readFileSync(filePath, 'utf8');
  const lines = src.split('\n');
  const relPath = relative(root, filePath).replace(/\\/g, '/');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;

    // Rule 9
    HARD_COLOR_RE.lastIndex = 0;
    let hcMatch = HARD_COLOR_RE.exec(line);
    while (hcMatch !== null) {
      const matchText = hcMatch[0];
      const matchIndex = hcMatch.index;
      if (!isWhitelistedHardColor(line, matchText, matchIndex, relPath)) {
        violations.push({ file: relPath, line: i+1, rule: 9, text: matchText });
      }
      hcMatch = HARD_COLOR_RE.exec(line);
    }

    // Rule 10
    INLINE_SHADOW_RE.lastIndex = 0;
    let shMatch = INLINE_SHADOW_RE.exec(line);
    while (shMatch !== null) {
      const value = shMatch[1].trim();
      if (!isWhitelistedShadow(value)) {
        violations.push({ file: relPath, line: i+1, rule: 10, text: value });
      }
      shMatch = INLINE_SHADOW_RE.exec(line);
    }
  }
});

console.log(`Checked ${checkedFiles} files`);
console.log(`Found ${violations.length} violations:`);
for (const v of violations.slice(0, 20)) {
  console.log(`  [Rule ${v.rule}] ${v.file}:${v.line} — ${v.text}`);
}
if (violations.length > 20) {
  console.log(`  ... and ${violations.length - 20} more`);
}

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '.');
const UI_DIR = join(root, 'src/ui');
const IGNORED_DIRS = new Set(['node_modules', 'out', '.git', '.build-tmp', 'dist', 'assets']);

// Copy ALL the regexes from the actual script
const ALLOWED_SPACING_UNITS = new Set([1, 2, 4, 6, 8, 12]);
const ALLOWED_SPACING_ARBITRARY_PX = new Set([4, 8, 16, 24, 32, 48]);
const ALLOWED_TEXT_ARBITRARY_PX = new Set([10, 12, 14, 16, 18, 20, 24, 30, 36, 48, 60, 72, 96, 128]);
const ALLOWED_ROUNDED = new Set(['rounded-none', 'rounded-[2px]']);
const ALLOWED_SHADOW = new Set(['shadow-none', 'shadow-float']);

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

let violationCount = 0;
let checked = 0;

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
  const src = readFileSync(filePath, 'utf8');
  const lines = src.split('\n');
  const relPath = relative(root, filePath).replace(/\\/g, '/');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;

    // --- Rule 1: Spacing named classes ---
    const spacingClassRe = /\b([pmwh])([xytrlb])?-(\d+(?:\.\d+)?)\b/g;
    let m = spacingClassRe.exec(line);
    while (m !== null) {
      const prefix = m[1];
      const unitStr = m[3];
      const unit = parseFloat(unitStr);
      if (!ALLOWED_SPACING_UNITS.has(unit) && unit !== 0 && unit !== 0.5 && unit !== 1.5) {
        const className = m[0];
        if (!className.startsWith('text-') && !className.startsWith('z-') &&
            !className.startsWith('order-') && !className.startsWith('flex-')) {
          if ((prefix === 'w' || prefix === 'h') && unitStr.includes('/')) {
            // skip
          } else if (['top', 'bottom', 'left', 'right', 'inset'].some((p) => className.startsWith(p)) && unit === 0) {
            // skip
          } else {
            violationCount++;
            if (violationCount <= 5) console.log(`R1: ${relPath}:${i+1} - ${className}`);
          }
        }
      }
      m = spacingClassRe.exec(line);
    }

    // --- Rule 4: text-[Npx] ---
    const textArbitraryRe = /\btext-\[(\d+(?:\.\d+)?)(px|rem)?\]/g;
    m = textArbitraryRe.exec(line);
    while (m !== null) {
      violationCount++;
      if (violationCount <= 5) console.log(`R4: ${relPath}:${i+1} - ${m[0]}`);
      m = textArbitraryRe.exec(line);
    }

    // --- Rule 6: Border-radius ---
    const roundedRe = /\brounded-(none|sm|md|lg|xl|2xl|3xl|full|\[[^\]]+\])/g;
    m = roundedRe.exec(line);
    while (m !== null) {
      const className = m[0];
      if (!ALLOWED_ROUNDED.has(className) && !className.includes('var(')) {
        if (className.startsWith('rounded-[')) {
          const innerVal = className.slice(8, -1);
          const parsed = innerVal.match(/^(\d+(?:\.\d+)?)(px)?$/);
          if (parsed && parseFloat(parsed[1]) <= 2) { /* skip */ }
          else {
            violationCount++;
            if (violationCount <= 5) console.log(`R6: ${relPath}:${i+1} - ${className}`);
          }
        } else {
          violationCount++;
          if (violationCount <= 5) console.log(`R6: ${relPath}:${i+1} - ${className}`);
        }
      }
      m = roundedRe.exec(line);
    }

    // --- Rule 7: Box-shadow classes ---
    const shadowRe = /\bshadow-(none|sm|md|lg|xl|2xl|inner|\[[^\]]+\])/g;
    m = shadowRe.exec(line);
    while (m !== null) {
      const className = m[0];
      if (!ALLOWED_SHADOW.has(className) && !className.startsWith('shadow-[')) {
        violationCount++;
        if (violationCount <= 5) console.log(`R7: ${relPath}:${i+1} - ${className}`);
      }
      m = shadowRe.exec(line);
    }

    // --- Rule 9: rgba/hsla ---
    HARD_COLOR_RE.lastIndex = 0;
    let hcMatch = HARD_COLOR_RE.exec(line);
    while (hcMatch !== null) {
      if (!isWhitelistedHardColor(line, hcMatch[0], hcMatch.index, relPath)) {
        violationCount++;
        if (violationCount <= 5) console.log(`R9: ${relPath}:${i+1} - ${hcMatch[0]}`);
      }
      hcMatch = HARD_COLOR_RE.exec(line);
    }

    // --- Rule 10: Inline box-shadow ---
    INLINE_SHADOW_RE.lastIndex = 0;
    let shMatch = INLINE_SHADOW_RE.exec(line);
    while (shMatch !== null) {
      if (!isWhitelistedShadow(shMatch[1].trim())) {
        violationCount++;
        if (violationCount <= 5) console.log(`R10: ${relPath}:${i+1} - ${shMatch[1].trim()}`);
      }
      shMatch = INLINE_SHADOW_RE.exec(line);
    }

    // --- Rule 8: Inline spacing ---
    const inlineSpacingRe = /((?:margin|padding|gap|top|bottom|left|right|width|height)[A-Z]?[a-z]*|margin-[a-z]+|padding-[a-z]+):\s*(\d+(?:\.\d+)?)(px)?/g;
    m = inlineSpacingRe.exec(line);
    while (m !== null) {
      const val = parseFloat(m[2]);
      if (!isNaN(val) && val !== 0 && val !== 1 && val !== 2 && !ALLOWED_SPACING_ARBITRARY_PX.has(val)) {
        violationCount++;
        if (violationCount <= 5) console.log(`R8: ${relPath}:${i+1} - ${m[0]}`);
      }
      m = inlineSpacingRe.exec(line);
    }
  }

  if (checked % 50 === 0) console.log(`Progress: ${checked}...`);
});

console.log(`\nDone: ${checked} files, ${violationCount} violations`);

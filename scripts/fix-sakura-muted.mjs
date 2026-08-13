// Replace sakura-pastel muted #9a8b92 (RGB 154,139,146) with #8d7e85
// (RGB 141,126,133) to clear WCAG AA 3.0:1 against bg #faf4f0 (was 2.97:1,
// now 3.53:1). Manifest + all 6 CSS files. Handles both hex and rgba forms.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const REPLACEMENTS = [
  ['154, 139, 146', '141, 126, 133'], // rgba with spaces
  ['154,139,146', '141,126,133'], // rgba without spaces
  ['#9a8b92', '#8d7e85'], // plain hex
];

const FILES = [
  join(ROOT, 'themes/sakura-pastel/manifest.json'),
  ...['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode'].map(
    (a) => join(ROOT, `themes/sakura-pastel/assets/css/${a}.css`),
  ),
];

let totalReplacements = 0;
for (const file of FILES) {
  const src = readFileSync(file, 'utf8');
  let out = src;
  let fileCount = 0;
  for (const [from, to] of REPLACEMENTS) {
    let idx = out.indexOf(from);
    while (idx !== -1) {
      out = out.slice(0, idx) + to + out.slice(idx + from.length);
      fileCount++;
      idx = out.indexOf(from, idx + to.length);
    }
  }
  if (fileCount > 0) {
    writeFileSync(file, out, 'utf8');
    totalReplacements += fileCount;
    const rel = file.replace(ROOT + '/', '');
    console.log(`  ${rel}: ${fileCount} replacements`);
  }
}
console.log(`\nDone — ${totalReplacements} total replacements.`);

import { readFileSync } from 'node:fs';

const src = readFileSync('src/ui/App.tsx', 'utf8');
const lines = src.split('\n');

// ALL the regexes from checkLine
const spacingClassRe = /\b([pmwh])([xytrlb])?-(\d+(?:\.\d+)?)\b/g;
const arbitrarySpacingRe = /\b([pmwh])([xytrlb])?-\[(\d+(?:\.\d+)?)(px|rem)?\]/g;
const gapArbitraryRe = /\b(gap|space-[xy])-\[(\d+(?:\.\d+)?)(px|rem)?\]/g;
const textArbitraryRe = /\btext-\[(\d+(?:\.\d+)?)(px|rem)?\]/g;
const inlineFontRe = /(?:fontSize|font-size):\s*(\d+(?:\.\d+)?)(px)?/g;
const roundedRe = /\brounded-(none|sm|md|lg|xl|2xl|3xl|full|\[[^\]]+\])/g;
const shadowRe = /\bshadow-(none|sm|md|lg|xl|2xl|inner|\[[^\]]+\])/g;
const HARD_COLOR_RE = /(rgba?|hsla?)\((\d+(\.\d+)?\s*,\s*){2,3}(\d+(\.\d+)?)\)/g;
const INLINE_SHADOW_RE = /(?:box-shadow|boxShadow):\s*([^;}\n]+)/g;
const inlineSpacingRe = /((?:margin|padding|gap|top|bottom|left|right|width|height)[A-Z]?[a-z]*|margin-[a-z]+|padding-[a-z]+):\s*(\d+(?:\.\d+)?)(px)?/g;

const regexes = [
  ['spacingClassRe', spacingClassRe],
  ['arbitrarySpacingRe', arbitrarySpacingRe],
  ['gapArbitraryRe', gapArbitraryRe],
  ['textArbitraryRe', textArbitraryRe],
  ['inlineFontRe', inlineFontRe],
  ['roundedRe', roundedRe],
  ['shadowRe', shadowRe],
  ['HARD_COLOR_RE', HARD_COLOR_RE],
  ['INLINE_SHADOW_RE', INLINE_SHADOW_RE],
  ['inlineSpacingRe', inlineSpacingRe],
];

// Test each line with each regex to find catastrophic backtracking
let hangDetected = false;

for (let i = 0; i < lines.length && !hangDetected; i++) {
  const line = lines[i];
  if (line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*')) continue;

  for (const [name, re] of regexes) {
    re.lastIndex = 0;
    const start = Date.now();
    let count = 0;
    let m;
    while ((m = re.exec(line)) !== null && count < 200) {
      count++;
    }
    const elapsed = Date.now() - start;
    if (elapsed > 1000) {
      console.log(`CATASTROPHIC BACKTRACKING on line ${i + 1} with ${name}: ${elapsed}ms`);
      console.log(`  Line content (${line.length} chars): ${line.substring(0, 200)}...`);
      hangDetected = true;
      break;
    }
  }
}

// Now test specifically line 85 which has grid-cols-[62px_minmax(0,1fr)]
const line85 = lines[84]; // 0-indexed
console.log('\nLine 85:', line85);
// Test the spacing class regex on this line
spacingClassRe.lastIndex = 0;
const start = Date.now();
let m;
let count = 0;
while ((m = spacingClassRe.exec(line85)) !== null && count < 200) {
  count++;
}
console.log('spacingClassRe count:', count, 'time:', Date.now() - start, 'ms');

// Test on many similar lines to detect slowdown
const testLine = ' '.repeat(10000) + 'grid-cols-[62px_minmax(0,1fr)]' + ' '.repeat(10000);
for (const [name, re] of regexes) {
  re.lastIndex = 0;
  const start2 = Date.now();
  let count2 = 0;
  while ((m = re.exec(testLine)) !== null && count2 < 200) {
    count2++;
  }
  const elapsed2 = Date.now() - start2;
  if (elapsed2 > 100) {
    console.log(`SLOW on padded line with ${name}: ${elapsed2}ms`);
  }
}

console.log('\nDone');

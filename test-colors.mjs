import { readFileSync } from 'node:fs';

const src = readFileSync('src/ui/colors.ts', 'utf8');
const lines = src.split('\n');

const HARD_COLOR_RE = /(rgba?|hsla?)\((\d+(\.\d+)?\s*,\s*){2,3}(\d+(\.\d+)?)\)/g;
const INLINE_SHADOW_RE = /(?:box-shadow|boxShadow):\s*([^;}\n]+)/g;
const spacingClassRe = /\b([pmwh])([xytrlb])?-(\d+(?:\.\d+)?)\b/g;
const inlineSpacingRe = /((?:margin|padding|gap|top|bottom|left|right|width|height)[A-Z]?[a-z]*|margin-[a-z]+|padding-[a-z]+):\s*(\d+(?:\.\d+)?)(px)?/g;

// Test HARD_COLOR_RE on every line of colors.ts
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*')) continue;

  HARD_COLOR_RE.lastIndex = 0;
  const start = Date.now();
  let count = 0;
  let m;
  while ((m = HARD_COLOR_RE.exec(line)) !== null && count < 200) {
    count++;
  }
  const elapsed = Date.now() - start;
  if (elapsed > 50) {
    console.log(`HARD_COLOR slow on line ${i+1}: ${elapsed}ms, count: ${count}`);
    console.log(`  Line: ${line.substring(0, 150)}`);
  }
}

// Test inlineSpacingRe on every line
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*')) continue;

  inlineSpacingRe.lastIndex = 0;
  const start = Date.now();
  let count = 0;
  let m;
  while ((m = inlineSpacingRe.exec(line)) !== null && count < 200) {
    count++;
  }
  const elapsed = Date.now() - start;
  if (elapsed > 50) {
    console.log(`inlineSpacing slow on line ${i+1}: ${elapsed}ms, count: ${count}`);
  }
}

// What if combined: test the interaction of ALL regexes on one line?
const allRegexes = [
  /\b([pmwh])([xytrlb])?-(\d+(?:\.\d+)?)\b/g,
  /\b([pmwh])([xytrlb])?-\[(\d+(?:\.\d+)?)(px|rem)?\]/g,
  /\b(gap|space-[xy])-\[(\d+(?:\.\d+)?)(px|rem)?\]/g,
  /\btext-\[(\d+(?:\.\d+)?)(px|rem)?\]/g,
  /(?:fontSize|font-size):\s*(\d+(?:\.\d+)?)(px)?/g,
  /\brounded-(none|sm|md|lg|xl|2xl|3xl|full|\[[^\]]+\])/g,
  /\bshadow-(none|sm|md|lg|xl|2xl|inner|\[[^\]]+\])/g,
  HARD_COLOR_RE,
  INLINE_SHADOW_RE,
  inlineSpacingRe,
];

console.log('\n--- Testing all regexes on every line of colors.ts ---');
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*')) continue;

  for (const re of allRegexes) {
    re.lastIndex = 0;
    const start = Date.now();
    let count = 0;
    let m;
    while ((m = re.exec(line)) !== null && count < 200) {
      count++;
    }
    const elapsed = Date.now() - start;
    if (elapsed > 100) {
      console.log(`Line ${i+1}, regex ${re.source.substring(0, 30)}: ${elapsed}ms`);
      console.log(`  Line content: ${line.substring(0, 200)}`);
    }
  }
}

console.log('\nDone - colors.ts test');

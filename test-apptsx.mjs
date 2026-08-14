import { readFileSync } from 'node:fs';

const src = readFileSync('src/ui/App.tsx', 'utf8');
const lines = src.split('\n');

const ALLOWED_SPACING_UNITS = new Set([1, 2, 4, 6, 8, 12]);
const ALLOWED_SPACING_ARBITRARY_PX = new Set([4, 8, 16, 24, 32, 48]);
const ALLOWED_TEXT_ARBITRARY_PX = new Set([10, 12, 14, 16, 18, 20, 24, 30, 36, 48, 60, 72, 96, 128]);
const ALLOWED_ROUNDED = new Set(['rounded-none', 'rounded-[2px]']);
const ALLOWED_SHADOW = new Set(['shadow-none', 'shadow-float']);
const HARD_COLOR_RE = /(rgba?|hsla?)\((\d+(\.\d+)?\s*,\s*){2,3}(\d+(\.\d+)?)\)/g;
const INLINE_SHADOW_RE = /(?:box-shadow|boxShadow):\s*([^;}\n]+)/g;

function parsePxValue(raw) {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(-?\d+(?:\.\d+)?)(px)?$/);
  if (!match) return null;
  return parseFloat(match[1]);
}

function checkLine(line, lineNum) {
  const spacingClassRe = /\b([pmwh])([xytrlb])?-(\d+(?:\.\d+)?)\b/g;
  let m = spacingClassRe.exec(line);
  while (m !== null) {
    m = spacingClassRe.exec(line);
  }

  const arbitrarySpacingRe = /\b([pmwh])([xytrlb])?-\[(\d+(?:\.\d+)?)(px|rem)?\]/g;
  m = arbitrarySpacingRe.exec(line);
  while (m !== null) { m = arbitrarySpacingRe.exec(line); }

  const gapArbitraryRe = /\b(gap|space-[xy])-\[(\d+(?:\.\d+)?)(px|rem)?\]/g;
  m = gapArbitraryRe.exec(line);
  while (m !== null) { m = gapArbitraryRe.exec(line); }

  const textArbitraryRe = /\btext-\[(\d+(?:\.\d+)?)(px|rem)?\]/g;
  m = textArbitraryRe.exec(line);
  while (m !== null) { m = textArbitraryRe.exec(line); }

  const inlineFontRe = /(?:fontSize|font-size):\s*(\d+(?:\.\d+)?)(px)?/g;
  m = inlineFontRe.exec(line);
  while (m !== null) { m = inlineFontRe.exec(line); }

  const roundedRe = /\brounded-(none|sm|md|lg|xl|2xl|3xl|full|\[[^\]]+\])/g;
  m = roundedRe.exec(line);
  while (m !== null) { m = roundedRe.exec(line); }

  const shadowRe = /\bshadow-(none|sm|md|lg|xl|2xl|inner|\[[^\]]+\])/g;
  m = shadowRe.exec(line);
  while (m !== null) { m = shadowRe.exec(line); }

  HARD_COLOR_RE.lastIndex = 0;
  let hcMatch = HARD_COLOR_RE.exec(line);
  while (hcMatch !== null) { hcMatch = HARD_COLOR_RE.exec(line); }

  INLINE_SHADOW_RE.lastIndex = 0;
  let shMatch = INLINE_SHADOW_RE.exec(line);
  while (shMatch !== null) { shMatch = INLINE_SHADOW_RE.exec(line); }

  const inlineSpacingRe = /((?:margin|padding|gap|top|bottom|left|right|width|height)[A-Z]?[a-z]*|margin-[a-z]+|padding-[a-z]+):\s*(\d+(?:\.\d+)?)(px)?/g;
  m = inlineSpacingRe.exec(line);
  while (m !== null) { m = inlineSpacingRe.exec(line); }
}

// Test each line of App.tsx
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*')) continue;
  const start = Date.now();
  checkLine(line, i + 1);
  const elapsed = Date.now() - start;
  if (elapsed > 100) {
    console.log(`Line ${i+1}: ${elapsed}ms`);
    console.log(`  Content: ${line.substring(0, 200)}`);
  }
}

console.log('Done');

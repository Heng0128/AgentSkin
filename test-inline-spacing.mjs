import { readFileSync } from 'node:fs';

const inlineSpacingRe = /((?:margin|padding|gap|top|bottom|left|right|width|height)[A-Z]?[a-z]*|margin-[a-z]+|padding-[a-z]+):\s*(\d+(?:\.\d+)?)(px)?/g;

// Test 1: a very long line with many potential matches
let line = ' '.repeat(100) + 'width'.repeat(20) + ': 16px;';
inlineSpacingRe.lastIndex = 0;
let start = Date.now();
let m, count = 0;
while ((m = inlineSpacingRe.exec(line)) !== null && count < 200) { count++; }
console.log('Test 1:', Date.now() - start, 'ms, count:', count);

// Test 2: the actual problematic input - width:100 (App.tsx line 94)
line = "'height:100%' (h-full) in the pages";
inlineSpacingRe.lastIndex = 0;
start = Date.now();
count = 0;
while ((m = inlineSpacingRe.exec(line)) !== null && count < 200) { count++; }
console.log('Test 2:', Date.now() - start, 'ms, count:', count);

// Test 3: Potential worst case - single letter chars after width
line = 'width' + 'a'.repeat(50) + ': 16px;';
inlineSpacingRe.lastIndex = 0;
start = Date.now();
count = 0;
while ((m = inlineSpacingRe.exec(line)) !== null && count < 200) { count++; }
console.log('Test 3:', Date.now() - start, 'ms, count:', count);

// Test 4: The REAL test - combine all three main regexes together
const spacingClassRe = /\b([pmwh])([xytrlb])?-(\d+(?:\.\d+)?)\b/g;

line = 'width:100';
spacingClassRe.lastIndex = 0;
start = Date.now();
count = 0;
while ((m = spacingClassRe.exec(line)) !== null && count < 200) { count++; }
console.log('Test 4 (spacingClass):', Date.now() - start, 'ms, count:', count);

line = 'width:100';
inlineSpacingRe.lastIndex = 0;
start = Date.now();
count = 0;
while ((m = inlineSpacingRe.exec(line)) !== null && count < 200) {
  console.log('  match:', m[1], 'lastIndex:', inlineSpacingRe.lastIndex);
  count++;
}
console.log('Test 5 (inlineSpacing):', Date.now() - start, 'ms, count:', count);

// Test 6: What about lines with < or > characters that might confuse things?
// Test every line of App.tsx with just the inlineSpacingRe
const src = readFileSync('src/ui/App.tsx', 'utf8');
const lines = src.split('\n');

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  inlineSpacingRe.lastIndex = 0;
  start = Date.now();
  count = 0;
  while ((m = inlineSpacingRe.exec(line)) !== null && count < 200) { count++; }
  const elapsed = Date.now() - start;
  if (elapsed > 50) {
    console.log(`App.tsx line ${i+1}: ${elapsed}ms, count: ${count}`);
    console.log(`  ${line.substring(0, 200)}`);
  }
}

// Test 7: Every line of agentSkinClient.ts (file #1) with ALL rules
const src1 = readFileSync('src/ui/agentSkinClient.ts', 'utf8');
const lines1 = src1.split('\n');

for (let i = 0; i < lines1.length; i++) {
  const line = lines1[i];
  if (line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*')) continue;

  // Test ALL regexes
  const allRe = [spacingClassRe, inlineSpacingRe, /(?:fontSize|font-size):\s*(\d+(?:\.\d+)?)(px)?/g];
  for (const re of allRe) {
    re.lastIndex = 0;
    start = Date.now();
    count = 0;
    while ((m = re.exec(line)) !== null && count < 200) { count++; }
    const elapsed = Date.now() - start;
    if (elapsed > 100) {
      console.log(`agentSkinClient.ts line ${i+1}, ${re.source.substring(0, 30)}: ${elapsed}ms`);
    }
  }
}

console.log('\nDone');

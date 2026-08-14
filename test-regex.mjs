const HARD_COLOR_RE = /(rgba?|hsla?)\((\d+(\.\d+)?\s*,\s*){2,3}(\d+(\.\d+)?)\)/g;
const INLINE_SHADOW_RE = /(?:box-shadow|boxShadow):\s*([^;}\n]+)/g;

// Test 1: simple rgba
let line = 'rgba(0,0,0,0.4)';
HARD_COLOR_RE.lastIndex = 0;
let m, count = 0;
while ((m = HARD_COLOR_RE.exec(line)) !== null && count < 100) {
  console.log('T1 match:', m[0], 'lastIndex:', HARD_COLOR_RE.lastIndex);
  count++;
}
console.log('T1 count:', count >= 100 ? 'INFINITE LOOP' : count);

// Test 2: the actual ThemesPage line
line = "style={{ boxShadow: 'var(--shadow, 0 10px 28px rgba(0,0,0,0.4))' }}";
HARD_COLOR_RE.lastIndex = 0;
count = 0;
while ((m = HARD_COLOR_RE.exec(line)) !== null && count < 100) {
  console.log('T2 match:', m[0], 'lastIndex:', HARD_COLOR_RE.lastIndex);
  count++;
}
console.log('T2 count:', count >= 100 ? 'INFINITE LOOP' : count);

// Test 3: a very long line to check performance
line = 'a'.repeat(10000) + 'rgba(1,2,3,0.5)' + 'b'.repeat(10000);
HARD_COLOR_RE.lastIndex = 0;
count = 0;
const start = Date.now();
while ((m = HARD_COLOR_RE.exec(line)) !== null && count < 100) {
  count++;
}
console.log('T3 count:', count >= 100 ? 'INFINITE LOOP' : count, 'time:', Date.now() - start, 'ms');

// Test 4: Try to find problematic input that causes infinite loop
// An empty match or a zero-width match would cause an infinite loop
// The regex requires at least one digit, so it shouldn't match empty strings
line = 'rgba(,)';
HARD_COLOR_RE.lastIndex = 0;
count = 0;
while ((m = HARD_COLOR_RE.exec(line)) !== null && count < 100) {
  console.log('T4 match:', m[0], 'lastIndex:', HARD_COLOR_RE.lastIndex);
  count++;
}
console.log('T4 count:', count >= 100 ? 'INFINITE LOOP' : count);

// Test 5: Check if inline shadow regex can loop infinitely
line = 'box-shadow: something';
INLINE_SHADOW_RE.lastIndex = 0;
count = 0;
while ((m = INLINE_SHADOW_RE.exec(line)) !== null && count < 100) {
  console.log('T5 match:', m[0], 'lastIndex:', INLINE_SHADOW_RE.lastIndex);
  count++;
}
console.log('T5 count:', count >= 100 ? 'INFINITE LOOP' : count);

// Test 6: real-world complex line from globals.css
line = 'box-shadow: 0 0 0 1px rgba(255, 69, 58, 0.15);';
HARD_COLOR_RE.lastIndex = 0;
count = 0;
while ((m = HARD_COLOR_RE.exec(line)) !== null && count < 100) {
  console.log('T6 match:', m[0], 'lastIndex:', HARD_COLOR_RE.lastIndex);
  count++;
}
console.log('T6 count:', count >= 100 ? 'INFINITE LOOP' : count);

console.log('\nAll tests complete');

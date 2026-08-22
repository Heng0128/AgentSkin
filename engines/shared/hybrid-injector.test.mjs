/**
 * hybrid-injector.test.mjs — standalone verification for HybridInjector.
 *
 * Simulates a minimal DOM + rAF environment to validate:
 *   1. applyIncremental: setProperty per token, dedup, rAF batching
 *   2. applyFullTheme: CSSStyleSheet.replaceSync atomic replace
 *   3. applyBatch: multi-rule atomic update
 *   4. hotReplace: flicker-free layer swap
 *   5. dispose: full cleanup
 *
 * Run: node engines/shared/hybrid-injector.test.mjs
 */

// ---------------------------------------------------------------------------
// Minimal DOM mock (no external deps)
// ---------------------------------------------------------------------------
class MockCSSStyleSheet {
  constructor() { this.cssRules = []; this.__agentskin = false; this.__agentskin_layer = ''; this._css = ''; }
  replaceSync(css) {
    this._css = css;
    const matches = css.match(/[^{}]+\{[^{}]*\}/g);
    this.cssRules = matches ? matches.map((_, i) => ({ index: i })) : [];
  }
}

const _adoptedSheets = [];

const mockDocument = {
  documentElement: {
    style: {
      _props: new Map(),
      setProperty(k, v) { this._props.set(k, v); },
      getPropertyValue(k) { return this._props.get(k) || ''; },
    },
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      contains(c) { return this._set.has(c); },
    },
  },
  get adoptedStyleSheets() { return _adoptedSheets; },
  set adoptedStyleSheets(v) { _adoptedSheets.length = 0; _adoptedSheets.push(...v); },
};

let _rafCallbacks = [];
function mockRaf(cb) { _rafCallbacks.push(cb); return _rafCallbacks.length; }
function flushRaf() {
  const cbs = _rafCallbacks;
  _rafCallbacks = [];
  for (const cb of cbs) cb();
}

global.document = mockDocument;
global.CSSStyleSheet = MockCSSStyleSheet;
global.requestAnimationFrame = mockRaf;
global.cancelAnimationFrame = () => {};
// Minimal window mock: in CDP the IIFE runs in the page context where
// window === global. In Node test we approximate with a shared object.
global.window = global;

// ---------------------------------------------------------------------------
// Load the IIFE source
// ---------------------------------------------------------------------------
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'hybrid-injector.mjs'), 'utf8');

const fn = new Function(src + '\nreturn window;');
const win = fn();

const { HybridInjector } = win;

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${label}`);
  } else {
    failed++;
    console.error(`  FAIL: ${label}`);
  }
}

function group(name) {
  console.log(`\n[${name}]`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

group('V1: applyIncremental immediate mode');
{
  const h = new HybridInjector();
  const count = h.applyIncremental({
    '--agentskin-accent': '#ff0000',
    '--agentskin-bg': '#000000',
  }, true);
  assert(count === 2, 'returns 2 for 2 new tokens');
  assert(
    mockDocument.documentElement.style.getPropertyValue('--agentskin-accent') === '#ff0000',
    'accent token set on documentElement'
  );
}

group('V2: applyIncremental dedup');
{
  const h = new HybridInjector();
  h.applyIncremental({ '--agentskin-accent': '#ff0000' }, true);
  const count2 = h.applyIncremental({ '--agentskin-accent': '#ff0000' }, true);
  assert(count2 === 0, 'duplicate token returns 0');
}

group('V3: applyIncremental rAF batching');
{
  _rafCallbacks = [];
  const h = new HybridInjector();
  h.applyIncremental({ '--agentskin-accent': '#ff0000' });
  h.applyIncremental({ '--agentskin-bg': '#000000' });
  h.applyIncremental({ '--agentskin-text': '#ffffff' });
  assert(_rafCallbacks.length === 1, 'single rAF scheduled for 3 rapid calls');
  flushRaf();
  assert(
    mockDocument.documentElement.style.getPropertyValue('--agentskin-accent') === '#ff0000',
    'accent flushed'
  );
  assert(
    mockDocument.documentElement.style.getPropertyValue('--agentskin-bg') === '#000000',
    'bg flushed'
  );
}

group('V4: applyFullTheme atomic replace');
{
  const h = new HybridInjector();
  const ruleCount = h.applyFullTheme('palette', 'html { --agentskin-accent: #abc; }');
  assert(ruleCount >= 1, 'returns rule count >= 1');
  assert(_adoptedSheets.length === 1, 'one adoptedStyleSheet after applyFullTheme');
  assert(
    _adoptedSheets[0].__agentskin_layer === 'palette',
    'sheet tagged as palette layer'
  );
  h.applyFullTheme('palette', 'html { --agentskin-accent: #def; }');
  assert(_adoptedSheets.length === 1, 'still one adoptedStyleSheet after replace');
}

group('V5: applyBatch multi-rule atomic');
{
  const h = new HybridInjector();
  const count = h.applyBatch('tokens', [
    { selectorText: 'html', style: { '--vscode-foreground': 'var(--agentskin-text)' } },
    { selectorText: 'body', style: { '--vscode-bg': 'transparent' } },
  ]);
  assert(count >= 2, 'returns rule count >= 2 for 2 rules');
}

group('V6: hotReplace flicker-free swap');
{
  const h = new HybridInjector();
  h.applyFullTheme('cosmetic', 'html { color: red; }');
  const before = _adoptedSheets.length;
  h.hotReplace('cosmetic', 'html { color: blue; }');
  assert(_adoptedSheets.length === before, 'hotReplace does not add new sheet');
  const cosmeticSheet = _adoptedSheets.find(s => s.__agentskin_layer === 'cosmetic');
  assert(
    cosmeticSheet && cosmeticSheet._css.includes('color: blue'),
    'CSS content updated in place'
  );
}

group('V7: dispose full cleanup');
{
  const h = new HybridInjector();
  h.applyFullTheme('palette', 'html { color: red; }');
  h.applyFullTheme('tokens', 'html { color: blue; }');
  h.applyIncremental({ '--agentskin-accent': '#fff' }, true);
  h.dispose();
  assert(_adoptedSheets.length === 0, 'all adoptedStyleSheets removed');
}

group('V8: idempotency guard');
{
  const fn2 = new Function(src + '\nreturn window;');
  const win2 = fn2();
  assert(typeof win2.HybridInjector === 'function', 'HybridInjector accessible after re-eval');
}

group('V9: removeLayer');
{
  const h = new HybridInjector();
  h.applyFullTheme('palette', 'html { color: red; }');
  h.applyFullTheme('tokens', 'html { color: blue; }');
  assert(_adoptedSheets.length === 2, 'two sheets before remove');
  h.removeLayer('palette');
  assert(_adoptedSheets.length === 1, 'one sheet after removeLayer');
  assert(
    !_adoptedSheets.some(s => s.__agentskin_layer === 'palette'),
    'palette layer removed'
  );
}

console.log(`\n${'='.repeat(50)}`);
console.log(`Result: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

if (failed > 0) process.exit(1);

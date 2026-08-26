/**
 * injection-feedback.test.mjs — standalone verification for InjectionFeedback.
 *
 * Run: node engines/shared/injection-feedback.test.mjs
 */

// ---------------------------------------------------------------------------
// Minimal DOM mock
// ---------------------------------------------------------------------------
class MockNode {
  constructor() {
    this.childNodes = []; this.attributes = {}; this.style = {};
    this.parentNode = null; this._textContent = ''; this.id = '';
    this.className = ''; this._innerHTML = '';
  }
  get textContent() {
    return this._textContent || this.childNodes.map(c => c.textContent || '').join('');
  }
  set textContent(v) { this._textContent = v; }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) { this._innerHTML = v; if (v === '') this.childNodes = []; }
  appendChild(c) { c.parentNode = this; this.childNodes.push(c); return c; }
  removeChild(c) { const i = this.childNodes.indexOf(c); if (i !== -1) this.childNodes.splice(i, 1); return c; }
  setAttribute(k, v) { this.attributes[k] = v; }
  getAttribute(k) { return this.attributes[k] ?? null; }
  removeAttribute(k) { delete this.attributes[k]; }
  getElementById(id) {
    const walk = (nodes) => { for (const n of nodes) { if (n.id === id) return n; const f = walk(n.childNodes); if (f) return f; } return null; };
    return walk([rootEl]);
  }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

const rootEl = new MockNode(); rootEl.id = 'html';
const bodyEl = new MockNode(); bodyEl.id = 'body'; rootEl.appendChild(bodyEl);
const headEl = new MockNode(); headEl.id = 'head'; rootEl.appendChild(headEl);

const mockDocument = {
  getElementById(id) { return id === 'html' ? rootEl : id === 'body' ? bodyEl : id === 'head' ? headEl : rootEl.getElementById(id); },
  get body() { return bodyEl; }, get documentElement() { return rootEl; }, get head() { return headEl; },
  createElement() { return new MockNode(); }, querySelector() { return null; }, querySelectorAll() { return []; },
};

global.document = mockDocument; global.window = global;
global.setTimeout = () => 0; global.clearTimeout = () => {};

// ---------------------------------------------------------------------------
// Load IIFE
// ---------------------------------------------------------------------------
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'injection-feedback.mjs'), 'utf8');
const fn = new Function(src + '\nreturn window;');
const win = fn();
const { InjectionFeedback } = win;
const STATUS_VALUES = win.__AGENTSKIN_FEEDBACK__.STATUS_VALUES;

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------
let passed = 0, failed = 0;
function assert(c, l) { if (c) { passed++; console.log(`  PASS: ${l}`); } else { failed++; console.error(`  FAIL: ${l}`); } }
function group(n) { console.log(`\n[${n}]`); }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

group('F1: showStatus renders overlay');
{
  const fb = new InjectionFeedback();
  fb.showStatus('loading', 'Applying theme...');
  const el = mockDocument.getElementById('agentskin-feedback-overlay');
  assert(el !== null, 'overlay created');
  assert(el.getAttribute('data-agentskin-feedback') === 'active', 'overlay active');
  assert(el.getAttribute('data-agentskin-feedback-status') === 'loading', 'status=loading');
  assert(el.textContent.includes('Applying theme...'), 'message rendered');
  assert(fb.isVisible === true, 'isVisible=true');
  fb.dispose();
}

group('F2: hideStatus removes active state');
{
  const fb = new InjectionFeedback();
  fb.showStatus('loading'); fb.hideStatus();
  const el = mockDocument.getElementById('agentskin-feedback-overlay');
  assert(el.getAttribute('data-agentskin-feedback') === '', 'overlay inactive');
  assert(fb.isVisible === false, 'isVisible=false');
  fb.dispose();
}

group('F3: multi-instance no conflict');
{
  const fb1 = new InjectionFeedback(), fb2 = new InjectionFeedback();
  fb1.showStatus('loading', 'I1'); fb2.showStatus('success', 'I2');
  const el = mockDocument.getElementById('agentskin-feedback-overlay');
  assert(el.getAttribute('data-af-instance') === fb2.instanceId, 'owned by instance 2');
  assert(el.getAttribute('data-agentskin-feedback-status') === 'success', 'status reflects I2');
  assert(el.textContent.includes('I2'), 'message reflects I2');
  fb1.dispose(); fb2.dispose();
}

group('F4: idempotency guard');
{
  const fn2 = new Function(src + '\nreturn window;');
  const win2 = fn2();
  assert(typeof win2.InjectionFeedback === 'function', 'accessible after re-eval');
  const fb = new win2.InjectionFeedback();
  assert(fb instanceof InjectionFeedback, 'instanceof check');
}

group('F5: state transition + progress');
{
  const fb = new InjectionFeedback();
  fb.showStatus('loading');
  const el = mockDocument.getElementById('agentskin-feedback-overlay');
  assert(el.getAttribute('data-agentskin-feedback-status') === 'loading', 'initial=loading');
  fb.updateProgress(50);
  const bar = el.childNodes.find(c => c.className === 'af-progress');
  assert(bar && bar.style.width === '50%', 'progress=50%');
  fb.updateProgress(150); assert(bar.style.width === '100%', 'clamped to 100');
  fb.updateProgress(-10); assert(bar.style.width === '0%', 'clamped to 0');
  fb.showStatus('success', 'Done');
  assert(el.getAttribute('data-agentskin-feedback-status') === 'success', 'status=success');
  assert(el.textContent.includes('Done'), 'success message');
  fb.dispose();
}

group('F6: dispose cleanup');
{
  const fb = new InjectionFeedback();
  fb.showStatus('loading'); fb.dispose();
  assert(fb.isVisible === false, 'not visible after dispose');
  assert(fb._disposed === true, 'disposed flag set');
  fb.showStatus('success'); fb.hideStatus(); fb.updateProgress(50);
  assert(true, 'post-dispose calls safe');
}

group('F7: all statuses + invalid');
{
  for (const s of ['loading', 'success', 'error', 'cancelled']) {
    const fb = new InjectionFeedback();
    fb.showStatus(s);
    const el = mockDocument.getElementById('agentskin-feedback-overlay');
    assert(el.getAttribute('data-agentskin-feedback-status') === s, `status "${s}" ok`);
    fb.dispose();
  }
  const fb = new InjectionFeedback(); fb.showStatus('bogus');
  const el = mockDocument.getElementById('agentskin-feedback-overlay');
  assert(!el || el.getAttribute('data-agentskin-feedback') !== 'active', 'invalid ignored');
  fb.dispose();
}

group('F8: STATUS_VALUES export');
{
  assert(STATUS_VALUES instanceof Set, 'is Set');
  assert(STATUS_VALUES.has('loading') && STATUS_VALUES.has('success'), 'has loading/success');
  assert(STATUS_VALUES.has('error') && STATUS_VALUES.has('cancelled'), 'has error/cancelled');
}

// ---------------------------------------------------------------------------
// Boundary condition tests (group B)
// ---------------------------------------------------------------------------

group('B1: showStatus with undefined message uses default');
{
  const fb = new InjectionFeedback();
  fb.showStatus('loading');
  const el = mockDocument.getElementById('agentskin-feedback-overlay');
  assert(el !== null, 'overlay created');
  assert(el.textContent.includes('Applying theme...'), 'default loading message used');
  fb.dispose();
}

group('B2: updateProgress after dispose is safely ignored');
{
  const fb = new InjectionFeedback();
  fb.showStatus('loading');
  const el = mockDocument.getElementById('agentskin-feedback-overlay');
  const bar = el.childNodes.find(c => c.className === 'af-progress');
  fb.updateProgress(75);
  assert(bar.style.width === '75%', 'progress set before dispose');
  fb.dispose();
  fb.updateProgress(99);
  assert(bar.style.width === '75%', 'progress unchanged after dispose');
  assert(fb.isVisible === false, 'not visible after dispose');
}

group('B3: hideStatus without prior show is safely ignored');
{
  const fb = new InjectionFeedback();
  assert(fb.isVisible === false, 'initially not visible');
  fb.hideStatus();
  assert(true, 'hideStatus on fresh instance does not throw');
  assert(fb.isVisible === false, 'still not visible');
  fb.dispose();
}

group('B4: rapid showStatus transitions update overlay correctly');
{
  const fb = new InjectionFeedback();
  fb.showStatus('loading', 'Step 1');
  fb.showStatus('success', 'Step 2');
  fb.showStatus('error', 'Step 3');
  fb.showStatus('cancelled', 'Step 4');
  const el = mockDocument.getElementById('agentskin-feedback-overlay');
  assert(el.getAttribute('data-agentskin-feedback-status') === 'cancelled', 'final status=cancelled');
  assert(el.getAttribute('data-agentskin-feedback') === 'active', 'overlay still active');
  assert(el.textContent.includes('Step 4'), 'final message rendered');
  fb.dispose();
}

group('B5: instanceId is unique across multiple instances');
{
  const instances = Array.from({ length: 20 }, () => new InjectionFeedback());
  const ids = instances.map(fb => fb.instanceId);
  const unique = new Set(ids);
  assert(unique.size === ids.length, 'all 20 instanceIds are unique');
  instances.forEach(fb => fb.dispose());
}

console.log(`\n${'='.repeat(50)}`);
console.log(`Result: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));
if (failed > 0) process.exit(1);

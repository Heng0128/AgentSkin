// SPDX-License-Identifier: MPL-2.0

/**
 * ambient-router.test.mjs — node:test verification for AmbientRouteManager.
 *
 * Uses a minimal DOM mock to validate:
 *   1. AMBIENT_INTENSITY constants
 *   2. Constructor options (cssVariable, transitionMs)
 *   3. Intensity key uppercase conversion
 *   4. stop() interface
 *   5. start() triggers initial detectPage
 *   6. onPageChange callback
 *
 * Run: node --test engines/workbuddy/ambient-router.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { AMBIENT_INTENSITY, AmbientRouteManager } from './ambient-router.mjs';

// ---------------------------------------------------------------------------
// Minimal DOM mock
// ---------------------------------------------------------------------------

class MockStyle {
  constructor() { this._props = new Map(); }
  setProperty(k, v) { this._props.set(k, v); }
  getPropertyValue(k) { return this._props.get(k) || ''; }
  removeProperty(k) { this._props.delete(k); }
}

class MockElement {
  constructor() {
    this.style = new MockStyle();
    this.classList = new Set();
    this.children = [];
    this.attributes = {};
    this._matchFn = null;
  }
  /** Set a custom match function for querySelector simulation. */
  setMatch(fn) { this._matchFn = fn; }
  /** Check if this element matches a selector. */
  matches(sel) { return this._matchFn ? this._matchFn(sel) : false; }
  setAttribute(k, v) { this.attributes[k] = v; }
  getAttribute(k) { return this.attributes[k] ?? null; }
  appendChild(c) { this.children.push(c); return c; }
  querySelector(sel) {
    const walk = (nodes) => {
      for (const n of nodes) {
        if (n.matches(sel)) return n;
        const found = walk(n.children);
        if (found) return found;
      }
      return null;
    };
    return walk(this.children);
  }
  querySelectorAll() { return []; }
}

class MockMutationObserver {
  constructor(callback) { this.callback = callback; this._connected = false; }
  observe() { this._connected = true; }
  disconnect() { this._connected = false; }
  takeRecords() { return []; }
  get connected() { return this._connected; }
}

function createMockDocument() {
  const root = new MockElement();
  const body = new MockElement();
  root.appendChild(body);

  return {
    documentElement: root,
    body,
    querySelector(sel) { return root.querySelector(sel); },
  };
}

// ---------------------------------------------------------------------------
// Test group 1: AMBIENT_INTENSITY constants
// ---------------------------------------------------------------------------

test('AMBIENT_INTENSITY.HOME === 1.0', () => {
  assert.strictEqual(AMBIENT_INTENSITY.HOME, 1.0);
});

test('AMBIENT_INTENSITY.WORKSPACE === 0.4', () => {
  assert.strictEqual(AMBIENT_INTENSITY.WORKSPACE, 0.4);
});

test('AMBIENT_INTENSITY.DETAIL === 0.15', () => {
  assert.strictEqual(AMBIENT_INTENSITY.DETAIL, 0.15);
});

// ---------------------------------------------------------------------------
// Test group 2: Constructor options
// ---------------------------------------------------------------------------

test('constructor accepts custom cssVariable', () => {
  const m = new AmbientRouteManager({ cssVariable: '--my-custom-var' });
  assert.strictEqual(m.cssVariable, '--my-custom-var');
});

test('constructor accepts custom transitionMs', () => {
  const m = new AmbientRouteManager({ transitionMs: 500 });
  assert.strictEqual(m.transitionMs, 500);
});

test('constructor defaults cssVariable to --agentskin-background-opacity', () => {
  const m = new AmbientRouteManager();
  assert.strictEqual(m.cssVariable, '--agentskin-background-opacity');
});

test('constructor defaults transitionMs to 350', () => {
  const m = new AmbientRouteManager();
  assert.strictEqual(m.transitionMs, 350);
});

test('constructor initializes currentPage to home', () => {
  const m = new AmbientRouteManager();
  assert.strictEqual(m.currentPage, 'home');
});

test('constructor initializes intensity to HOME value', () => {
  const m = new AmbientRouteManager();
  assert.strictEqual(m.intensity, AMBIENT_INTENSITY.HOME);
});

// ---------------------------------------------------------------------------
// Test group 3: Intensity key uppercase conversion
// ---------------------------------------------------------------------------

test('applyIntensity converts page key to uppercase for lookup', () => {
  const doc = createMockDocument();
  global.document = doc;
  global.MutationObserver = MockMutationObserver;

  const m = new AmbientRouteManager();
  m.applyIntensity('workspace');
  assert.strictEqual(m.intensity, 0.4);
  assert.strictEqual(
    doc.documentElement.style.getPropertyValue('--agentskin-background-opacity'),
    '0.4',
  );

  m.applyIntensity('detail');
  assert.strictEqual(m.intensity, 0.15);

  m.applyIntensity('home');
  assert.strictEqual(m.intensity, 1.0);

  delete global.document;
  delete global.MutationObserver;
});

// ---------------------------------------------------------------------------
// Test group 4: stop() interface
// ---------------------------------------------------------------------------

test('stop() disconnects the observer', () => {
  const doc = createMockDocument();
  global.document = doc;
  global.MutationObserver = MockMutationObserver;

  const m = new AmbientRouteManager();
  m.start();
  assert.ok(m.observer !== null, 'observer exists after start');
  assert.ok(m.observer.connected, 'observer is connected');

  m.stop();
  assert.strictEqual(m.observer, null, 'observer null after stop');

  delete global.document;
  delete global.MutationObserver;
});

test('start() returns a stop function', () => {
  const doc = createMockDocument();
  global.document = doc;
  global.MutationObserver = MockMutationObserver;

  const m = new AmbientRouteManager();
  const stopFn = m.start();
  assert.strictEqual(typeof stopFn, 'function', 'returns a function');

  stopFn();
  assert.strictEqual(m.observer, null, 'stop function disconnects observer');

  delete global.document;
  delete global.MutationObserver;
});

// ---------------------------------------------------------------------------
// Test group 5: start() triggers initial detectPage
// ---------------------------------------------------------------------------

test('start() applies initial intensity on call', () => {
  const doc = createMockDocument();
  global.document = doc;
  global.MutationObserver = MockMutationObserver;

  const m = new AmbientRouteManager();
  m.start();

  // Initial intensity should be applied immediately.
  // Note: String(1.0) === "1" in JavaScript, which is correct behavior
  // for CSS custom properties (both "1" and "1.0" are valid).
  assert.strictEqual(
    doc.documentElement.style.getPropertyValue('--agentskin-background-opacity'),
    String(AMBIENT_INTENSITY.HOME),
  );

  m.stop();
  delete global.document;
  delete global.MutationObserver;
});

// ---------------------------------------------------------------------------
// Test group 6: onPageChange callback
// ---------------------------------------------------------------------------

test('onPageChange callback interface exists and is callable', () => {
  const calls = [];
  const doc = createMockDocument();
  global.document = doc;
  global.MutationObserver = MockMutationObserver;

  const m = new AmbientRouteManager({
    onPageChange: (page, intensity) => { calls.push({ page, intensity }); },
  });

  // Manually trigger a page change.
  m.currentPage = 'workspace';
  m.applyIntensity('workspace');
  m.onPageChange?.('workspace', m.intensity);

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].page, 'workspace');
  assert.strictEqual(calls[0].intensity, 0.4);

  m.stop();
  delete global.document;
  delete global.MutationObserver;
});

test('onPageChange is invoked when start() detects a page change via MutationObserver', () => {
  const doc = createMockDocument();
  global.document = doc;
  global.MutationObserver = MockMutationObserver;

  const calls = [];
  const m = new AmbientRouteManager({
    onPageChange: (page, intensity) => { calls.push({ page, intensity }); },
  });

  m.start();

  // Simulate a workspace element appearing in the DOM.
  const wsEl = new MockElement();
  wsEl.setMatch((sel) => sel === '[data-page="chat"]');
  doc.body.appendChild(wsEl);

  // Trigger the MutationObserver callback manually.
  m.observer.callback();

  assert.strictEqual(calls.length, 1, 'onPageChange called once');
  assert.strictEqual(calls[0].page, 'workspace');
  assert.strictEqual(calls[0].intensity, 0.4);
  assert.strictEqual(m.currentPage, 'workspace');

  m.stop();
  delete global.document;
  delete global.MutationObserver;
});

// ---------------------------------------------------------------------------
// Test group 7: detectPage heuristics
// ---------------------------------------------------------------------------

test('detectPage returns "home" when home selector matches', () => {
  const doc = createMockDocument();
  global.document = doc;

  const homeEl = new MockElement();
  homeEl.setMatch((sel) => sel === '[data-page="home"]');
  doc.body.appendChild(homeEl);

  const m = new AmbientRouteManager();
  assert.strictEqual(m.detectPage(), 'home');

  delete global.document;
});

test('detectPage returns "workspace" when workspace selector matches', () => {
  const doc = createMockDocument();
  global.document = doc;

  const wsEl = new MockElement();
  wsEl.setMatch((sel) => sel === '.conversation-surface');
  doc.body.appendChild(wsEl);

  const m = new AmbientRouteManager();
  assert.strictEqual(m.detectPage(), 'workspace');

  delete global.document;
});

test('detectPage returns "detail" when detail selector matches', () => {
  const doc = createMockDocument();
  global.document = doc;

  const detailEl = new MockElement();
  detailEl.setMatch((sel) => sel === '.detail-surface');
  doc.body.appendChild(detailEl);

  const m = new AmbientRouteManager();
  assert.strictEqual(m.detectPage(), 'detail');

  delete global.document;
});

test('detectPage falls back to currentPage when no selector matches', () => {
  const doc = createMockDocument();
  global.document = doc;

  const m = new AmbientRouteManager();
  m.currentPage = 'workspace';
  assert.strictEqual(m.detectPage(), 'workspace');

  delete global.document;
});

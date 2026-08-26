// SPDX-License-Identifier: MIT
//
// @vitest-environment happy-dom
//
// # purge-engine.test.ts — unit tests for the Zero-Residual Cleanup Engine.
//
// Validates the four public exports:
//   - createPurgeContract: builds a normalized cleanup contract.
//   - purge: executes cleanup against a live DOM/window environment.
//   - verifyPurge: confirms all residuals are gone.
//   - contractFromManifest: reads manifest.json to build a contract.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  contractFromManifest,
  createPurgeContract,
  purge,
  verifyPurge,
} from '../../scripts/lib/purge-engine.mjs';

// ---------------------------------------------------------------------------
// Helpers — create a fresh happy-dom document for each test
// ---------------------------------------------------------------------------

let doc: Document;
let host: Record<string, unknown> & { __agentskinTimers: Map<string, number> };

beforeEach(() => {
  // happy-dom provides document; we reuse the global one but reset state.
  doc = document;

  // Clear any leftover body classes and children
  doc.body.className = '';
  doc.body.innerHTML = '';
  doc.documentElement.removeAttribute('style');

  // Create a minimal host mock
  host = {
    __agentskinTimers: new Map<string, ReturnType<typeof setTimeout>>(),
  };
});

// ---------------------------------------------------------------------------
// 1. createPurgeContract
// ---------------------------------------------------------------------------

describe('createPurgeContract', () => {
  it('creates a contract with empty defaults when no config is given', () => {
    const contract = createPurgeContract();
    expect(contract.domIds).toEqual([]);
    expect(contract.cssVars).toEqual([]);
    expect(contract.timers).toEqual([]);
    expect(contract.globalState).toEqual([]);
    expect(contract.classList).toEqual([]);
  });

  it('creates a contract with empty defaults when empty object is given', () => {
    const contract = createPurgeContract({});
    expect(contract.domIds).toEqual([]);
    expect(contract.cssVars).toEqual([]);
    expect(contract.timers).toEqual([]);
    expect(contract.globalState).toEqual([]);
    expect(contract.classList).toEqual([]);
  });

  it('normalizes all fields from a fully populated config', () => {
    const contract = createPurgeContract({
      domIds: ['agentskin-overlay', 'agentskin-sidebar'],
      cssVars: ['--agentskin-accent', '--agentskin-bg'],
      timers: ['theme-poll', 'anim-frame'],
      globalState: ['__agentskinTheme', '__agentskinReady'],
      classList: ['agentskin-dark', 'agentskin-injected'],
    });
    expect(contract.domIds).toEqual(['agentskin-overlay', 'agentskin-sidebar']);
    expect(contract.cssVars).toEqual(['--agentskin-accent', '--agentskin-bg']);
    expect(contract.timers).toEqual(['theme-poll', 'anim-frame']);
    expect(contract.globalState).toEqual(['__agentskinTheme', '__agentskinReady']);
    expect(contract.classList).toEqual(['agentskin-dark', 'agentskin-injected']);
  });

  it('returns an immutable copy — mutating input does not affect contract', () => {
    const config = { domIds: ['a'], cssVars: ['--x'] };
    const contract = createPurgeContract(config);
    config.domIds.push('b');
    config.cssVars.push('--y');
    expect(contract.domIds).toEqual(['a']);
    expect(contract.cssVars).toEqual(['--x']);
  });

  it('treats undefined/missing fields as empty arrays', () => {
    const contract = createPurgeContract({ domIds: ['only-dom'] });
    expect(contract.domIds).toEqual(['only-dom']);
    expect(contract.cssVars).toEqual([]);
    expect(contract.timers).toEqual([]);
    expect(contract.globalState).toEqual([]);
    expect(contract.classList).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. purge — DOM removal
// ---------------------------------------------------------------------------

describe('purge — DOM removal', () => {
  it('removes injected DOM elements by ID', () => {
    const el1 = doc.createElement('div');
    el1.id = 'agentskin-overlay';
    doc.body.appendChild(el1);

    const el2 = doc.createElement('div');
    el2.id = 'agentskin-sidebar';
    doc.body.appendChild(el2);

    const contract = createPurgeContract({
      domIds: ['agentskin-overlay', 'agentskin-sidebar'],
    });

    const report = purge(contract, { document: doc, host });
    expect(report.domRemoved).toBe(2);
    expect(doc.getElementById('agentskin-overlay')).toBeNull();
    expect(doc.getElementById('agentskin-sidebar')).toBeNull();
    expect(report.success).toBe(true);
  });

  it('does not throw when DOM element does not exist', () => {
    const contract = createPurgeContract({
      domIds: ['nonexistent-element'],
    });

    expect(() => purge(contract, { document: doc, host })).not.toThrow();
    const report = purge(contract, { document: doc, host });
    expect(report.domRemoved).toBe(0);
    expect(report.success).toBe(true);
  });

  it('only removes elements listed in the contract (whitelist)', () => {
    const injected = doc.createElement('div');
    injected.id = 'agentskin-overlay';
    doc.body.appendChild(injected);

    const native = doc.createElement('div');
    native.id = 'app-root';
    doc.body.appendChild(native);

    const contract = createPurgeContract({ domIds: ['agentskin-overlay'] });
    purge(contract, { document: doc, host });

    expect(doc.getElementById('agentskin-overlay')).toBeNull();
    expect(doc.getElementById('app-root')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. purge — CSS variable cleanup
// ---------------------------------------------------------------------------

describe('purge — CSS variable cleanup', () => {
  it('removes injected CSS variables from document.documentElement', () => {
    doc.documentElement.style.setProperty('--agentskin-accent', '#4a90d9');
    doc.documentElement.style.setProperty('--agentskin-bg', '#1e1e1e');

    const contract = createPurgeContract({
      cssVars: ['--agentskin-accent', '--agentskin-bg'],
    });

    const report = purge(contract, { document: doc, host });
    expect(report.cssVarsRemoved).toBe(2);
    expect(doc.documentElement.style.getPropertyValue('--agentskin-accent')).toBe('');
    expect(doc.documentElement.style.getPropertyValue('--agentskin-bg')).toBe('');
  });

  it('does not throw when CSS variable does not exist', () => {
    const contract = createPurgeContract({
      cssVars: ['--nonexistent-var'],
    });

    expect(() => purge(contract, { document: doc, host })).not.toThrow();
    const report = purge(contract, { document: doc, host });
    expect(report.cssVarsRemoved).toBe(0);
    expect(report.success).toBe(true);
  });

  it('preserves CSS variables not in the contract', () => {
    doc.documentElement.style.setProperty('--native-color', 'red');
    doc.documentElement.style.setProperty('--agentskin-accent', 'blue');

    const contract = createPurgeContract({ cssVars: ['--agentskin-accent'] });
    purge(contract, { document: doc, host });

    expect(doc.documentElement.style.getPropertyValue('--native-color')).toBe('red');
    expect(doc.documentElement.style.getPropertyValue('--agentskin-accent')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 4. purge — timer cleanup
// ---------------------------------------------------------------------------

describe('purge — timer cleanup', () => {
  it('clears and removes timers from the registry', () => {
    const handle1 = setTimeout(() => {}, 1000) as unknown as number;
    const handle2 = setTimeout(() => {}, 2000) as unknown as number;
    host.__agentskinTimers.set('theme-poll', handle1);
    host.__agentskinTimers.set('anim-frame', handle2);

    const contract = createPurgeContract({
      timers: ['theme-poll', 'anim-frame'],
    });

    const report = purge(contract, { document: doc, host });
    expect(report.timersCleared).toBe(2);
    expect(host.__agentskinTimers.has('theme-poll')).toBe(false);
    expect(host.__agentskinTimers.has('anim-frame')).toBe(false);
  });

  it('does not throw when timer key does not exist in registry', () => {
    const contract = createPurgeContract({
      timers: ['nonexistent-timer'],
    });

    expect(() => purge(contract, { document: doc, host })).not.toThrow();
    const report = purge(contract, { document: doc, host });
    expect(report.timersCleared).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. purge — global state cleanup
// ---------------------------------------------------------------------------

describe('purge — global state cleanup', () => {
  it('deletes global state keys from the host', () => {
    host.__agentskinTheme = 'midnight';
    host.__agentskinReady = true;

    const contract = createPurgeContract({
      globalState: ['__agentskinTheme', '__agentskinReady'],
    });

    const report = purge(contract, { document: doc, host });
    expect(report.stateCleared).toBe(2);
    expect('__agentskinTheme' in host).toBe(false);
    expect('__agentskinReady' in host).toBe(false);
  });

  it('does not throw when state key does not exist on host', () => {
    const contract = createPurgeContract({
      globalState: ['__nonexistent'],
    });

    expect(() => purge(contract, { document: doc, host })).not.toThrow();
    const report = purge(contract, { document: doc, host });
    expect(report.stateCleared).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. purge — body class cleanup
// ---------------------------------------------------------------------------

describe('purge — body class cleanup', () => {
  it('removes injected classes from body', () => {
    doc.body.classList.add('agentskin-dark');
    doc.body.classList.add('agentskin-injected');

    const contract = createPurgeContract({
      classList: ['agentskin-dark', 'agentskin-injected'],
    });

    const report = purge(contract, { document: doc, host });
    expect(report.classesRemoved).toBe(2);
    expect(doc.body.classList.contains('agentskin-dark')).toBe(false);
    expect(doc.body.classList.contains('agentskin-injected')).toBe(false);
  });

  it('does not throw when class is not on body', () => {
    const contract = createPurgeContract({
      classList: ['nonexistent-class'],
    });

    expect(() => purge(contract, { document: doc, host })).not.toThrow();
    const report = purge(contract, { document: doc, host });
    expect(report.classesRemoved).toBe(0);
  });

  it('preserves classes not in the contract', () => {
    doc.body.classList.add('native-class');
    doc.body.classList.add('agentskin-dark');

    const contract = createPurgeContract({ classList: ['agentskin-dark'] });
    purge(contract, { document: doc, host });

    expect(doc.body.classList.contains('native-class')).toBe(true);
    expect(doc.body.classList.contains('agentskin-dark')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. purge — full report structure
// ---------------------------------------------------------------------------

describe('purge — report structure', () => {
  it('returns a complete PurgeReport with all fields', () => {
    const contract = createPurgeContract({
      domIds: ['x'],
      cssVars: ['--x'],
      timers: ['x'],
      globalState: ['x'],
      classList: ['x'],
    });

    const report = purge(contract, { document: doc, host });
    expect(report).toHaveProperty('domRemoved');
    expect(report).toHaveProperty('cssVarsRemoved');
    expect(report).toHaveProperty('timersCleared');
    expect(report).toHaveProperty('stateCleared');
    expect(report).toHaveProperty('classesRemoved');
    expect(report).toHaveProperty('errors');
    expect(report).toHaveProperty('success');
    expect(Array.isArray(report.errors)).toBe(true);
  });

  it('reports success=true when all categories are clean (no errors)', () => {
    doc.body.innerHTML = '<div id="a"></div>';
    doc.documentElement.style.setProperty('--x', '1');
    host.__agentskinTimers.set('t', 123);
    host.s = 'v';
    doc.body.classList.add('c');

    const contract = createPurgeContract({
      domIds: ['a'],
      cssVars: ['--x'],
      timers: ['t'],
      globalState: ['s'],
      classList: ['c'],
    });

    const report = purge(contract, { document: doc, host });
    expect(report.success).toBe(true);
    expect(report.errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 8. verifyPurge
// ---------------------------------------------------------------------------

describe('verifyPurge', () => {
  it('returns false before purge (residuals exist)', () => {
    doc.body.innerHTML = '<div id="agentskin-overlay"></div>';
    doc.documentElement.style.setProperty('--agentskin-accent', '#4a90d9');
    host.__agentskinTimers.set('theme-poll', 123);
    host.__agentskinTheme = 'dark';
    doc.body.classList.add('agentskin-dark');

    const contract = createPurgeContract({
      domIds: ['agentskin-overlay'],
      cssVars: ['--agentskin-accent'],
      timers: ['theme-poll'],
      globalState: ['__agentskinTheme'],
      classList: ['agentskin-dark'],
    });

    expect(verifyPurge(contract, { document: doc, host })).toBe(false);
  });

  it('returns true after purge (all residuals gone)', () => {
    doc.body.innerHTML = '<div id="agentskin-overlay"></div>';
    doc.documentElement.style.setProperty('--agentskin-accent', '#4a90d9');
    host.__agentskinTimers.set('theme-poll', 123);
    host.__agentskinTheme = 'dark';
    doc.body.classList.add('agentskin-dark');

    const contract = createPurgeContract({
      domIds: ['agentskin-overlay'],
      cssVars: ['--agentskin-accent'],
      timers: ['theme-poll'],
      globalState: ['__agentskinTheme'],
      classList: ['agentskin-dark'],
    });

    purge(contract, { document: doc, host });
    expect(verifyPurge(contract, { document: doc, host })).toBe(true);
  });

  it('returns false when only partial cleanup occurred', () => {
    doc.body.innerHTML = '<div id="a"></div><div id="b"></div>';
    const contract = createPurgeContract({ domIds: ['a', 'b'] });

    // Manually remove only one element
    doc.getElementById('a')?.remove();

    expect(verifyPurge(contract, { document: doc, host })).toBe(false);

    // Remove the second
    doc.getElementById('b')?.remove();
    expect(verifyPurge(contract, { document: doc, host })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. contractFromManifest
// ---------------------------------------------------------------------------

describe('contractFromManifest', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `purge-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('reads a manifest.json and generates a valid contract', () => {
    const manifest = {
      name: 'test-theme',
      domIds: ['agentskin-overlay'],
      cssVars: ['--agentskin-accent'],
      timers: ['poll'],
      globalState: ['__theme'],
      classList: ['dark-mode'],
    };
    const manifestPath = join(tempDir, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const contract = contractFromManifest(manifestPath);
    expect(contract.domIds).toEqual(['agentskin-overlay']);
    expect(contract.cssVars).toEqual(['--agentskin-accent']);
    expect(contract.timers).toEqual(['poll']);
    expect(contract.globalState).toEqual(['__theme']);
    expect(contract.classList).toEqual(['dark-mode']);
  });

  it('treats missing fields as empty arrays', () => {
    const manifest = { name: 'minimal-theme' };
    const manifestPath = join(tempDir, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const contract = contractFromManifest(manifestPath);
    expect(contract.domIds).toEqual([]);
    expect(contract.cssVars).toEqual([]);
    expect(contract.timers).toEqual([]);
    expect(contract.globalState).toEqual([]);
    expect(contract.classList).toEqual([]);
  });

  it('throws when the manifest file does not exist', () => {
    expect(() => contractFromManifest(join(tempDir, 'nonexistent.json'))).toThrow(
      /Failed to read manifest/,
    );
  });

  it('throws when the manifest contains invalid JSON', () => {
    const manifestPath = join(tempDir, 'broken.json');
    writeFileSync(manifestPath, '{ invalid json }');

    expect(() => contractFromManifest(manifestPath)).toThrow(/Failed to parse manifest JSON/);
  });
});

// ---------------------------------------------------------------------------
// 10. Full lifecycle: create → inject → purge → verify
// ---------------------------------------------------------------------------

describe('full lifecycle', () => {
  it('simulates theme switch: inject → purge → verify across multiple themes', () => {
    // Theme A injection
    const elA = doc.createElement('div');
    elA.id = 'theme-a-overlay';
    doc.body.appendChild(elA);
    doc.documentElement.style.setProperty('--theme-a-color', 'red');
    host.__agentskinTimers.set('theme-a-poll', 42);
    host.__themeAState = 'active';
    doc.body.classList.add('theme-a-active');

    // Purge contract for Theme A
    const contractA = createPurgeContract({
      domIds: ['theme-a-overlay'],
      cssVars: ['--theme-a-color'],
      timers: ['theme-a-poll'],
      globalState: ['__themeAState'],
      classList: ['theme-a-active'],
    });

    // Before purge: verify should fail
    expect(verifyPurge(contractA, { document: doc, host })).toBe(false);

    // Execute purge
    const report = purge(contractA, { document: doc, host });
    expect(report.domRemoved).toBe(1);
    expect(report.cssVarsRemoved).toBe(1);
    expect(report.timersCleared).toBe(1);
    expect(report.stateCleared).toBe(1);
    expect(report.classesRemoved).toBe(1);
    expect(report.success).toBe(true);

    // After purge: verify should pass
    expect(verifyPurge(contractA, { document: doc, host })).toBe(true);

    // Theme B injection — no Theme A residuals
    const elB = doc.createElement('div');
    elB.id = 'theme-b-overlay';
    doc.body.appendChild(elB);
    doc.documentElement.style.setProperty('--theme-b-color', 'blue');
    doc.body.classList.add('theme-b-active');

    // Theme A contract should still report true (no Theme A artifacts remain)
    expect(verifyPurge(contractA, { document: doc, host })).toBe(true);

    // Theme B contract should report false (Theme B artifacts exist)
    const contractB = createPurgeContract({
      domIds: ['theme-b-overlay'],
      cssVars: ['--theme-b-color'],
      timers: [],
      globalState: [],
      classList: ['theme-b-active'],
    });
    expect(verifyPurge(contractB, { document: doc, host })).toBe(false);

    // Purge Theme B
    purge(contractB, { document: doc, host });
    expect(verifyPurge(contractB, { document: doc, host })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 11. Idempotency
// ---------------------------------------------------------------------------

describe('idempotency', () => {
  it('multiple purge calls do not throw and converge to clean state', () => {
    doc.body.innerHTML = '<div id="agentskin-x"></div>';
    doc.documentElement.style.setProperty('--x', '1');
    host.__agentskinTimers.set('tx', 99);
    host.__xState = true;
    doc.body.classList.add('cls-x');

    const contract = createPurgeContract({
      domIds: ['agentskin-x'],
      cssVars: ['--x'],
      timers: ['tx'],
      globalState: ['__xState'],
      classList: ['cls-x'],
    });

    // First purge — everything should be cleaned
    const report1 = purge(contract, { document: doc, host });
    expect(report1.domRemoved).toBe(1);
    expect(report1.cssVarsRemoved).toBe(1);
    expect(report1.timersCleared).toBe(1);
    expect(report1.stateCleared).toBe(1);
    expect(report1.classesRemoved).toBe(1);
    expect(report1.success).toBe(true);

    // Second purge — nothing left to clean, no errors
    const report2 = purge(contract, { document: doc, host });
    expect(report2.domRemoved).toBe(0);
    expect(report2.cssVarsRemoved).toBe(0);
    expect(report2.timersCleared).toBe(0);
    expect(report2.stateCleared).toBe(0);
    expect(report2.classesRemoved).toBe(0);
    expect(report2.success).toBe(true);
    expect(report2.errors).toEqual([]);

    // Third purge — still no errors (idempotent)
    const report3 = purge(contract, { document: doc, host });
    expect(report3.success).toBe(true);

    // Verification still passes
    expect(verifyPurge(contract, { document: doc, host })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 12. Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('handles purge with no document (timer/state cleanup only)', () => {
    host.__agentskinTimers.set('t1', 10);
    host.someState = 'value';

    const contract = createPurgeContract({
      timers: ['t1'],
      globalState: ['someState'],
    });

    const report = purge(contract, { host, document: null });
    expect(report.timersCleared).toBe(1);
    expect(report.stateCleared).toBe(1);
    expect(report.domRemoved).toBe(0);
    expect(report.cssVarsRemoved).toBe(0);
    expect(report.classesRemoved).toBe(0);
  });

  it('handles purge when body is missing (DOM/CSS/state only)', () => {
    const contract = createPurgeContract({
      domIds: ['a'],
      cssVars: ['--x'],
      classList: ['cls'],
    });

    // Provide a document without body
    const partialDoc = {
      getElementById: () => null,
      documentElement: { style: { getPropertyValue: () => '', removeProperty: () => {} } },
      body: null,
    } as Document;

    const report = purge(contract, { document: partialDoc, host });
    expect(report.classesRemoved).toBe(0);
    expect(report.success).toBe(true);
  });

  it('handles empty purge contract (no-op)', () => {
    const contract = createPurgeContract();
    const report = purge(contract, { document: doc, host });
    expect(report.domRemoved).toBe(0);
    expect(report.cssVarsRemoved).toBe(0);
    expect(report.timersCleared).toBe(0);
    expect(report.stateCleared).toBe(0);
    expect(report.classesRemoved).toBe(0);
    expect(report.success).toBe(true);
    expect(report.errors).toEqual([]);
  });
});

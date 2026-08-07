// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it } from 'vitest';
import { CssVariableGraph, VarType } from './variable-graph';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createGraph(): CssVariableGraph {
  return new CssVariableGraph();
}

// ---------------------------------------------------------------------------
// extractFromStyle
// ---------------------------------------------------------------------------

describe('extractFromStyle', () => {
  it('extracts two simple variable declarations', () => {
    const g = createGraph();
    g.extractFromStyle('--color: red; --bg: blue;');
    expect(g.size).toBe(2);
    expect(g.get('--color')?.value).toBe('red');
    expect(g.get('--bg')?.value).toBe('blue');
  });

  it('preserves values with spaces and special characters', () => {
    const g = createGraph();
    g.extractFromStyle(`--font: "Space Grotesk", sans-serif;`);
    expect(g.size).toBe(1);
    expect(g.get('--font')?.value).toBe('"Space Grotesk", sans-serif');
  });

  it('handles var() values with fallbacks', () => {
    const g = createGraph();
    g.extractFromStyle('--accent: var(--primary, #FF453A);');
    expect(g.get('--accent')?.value).toBe('var(--primary, #FF453A)');
  });

  it('skips variable declarations inside /* ... */ comments', () => {
    const g = createGraph();
    g.extractFromStyle(`/* --ignored: yes */ --active: green;`);
    expect(g.size).toBe(1);
    expect(g.get('--active')).not.toBeNull();
    expect(g.get('--ignored')).toBeNull();
  });

  it('is a no-op for empty string input', () => {
    const g = createGraph();
    g.extractFromStyle('');
    expect(g.size).toBe(0);
  });

  it('is a no-op for null input (graceful)', () => {
    const g = createGraph();
    // @ts-expect-error: testing runtime null guard
    g.extractFromStyle(null);
    expect(g.size).toBe(0);
  });

  it('is a no-op for undefined input (graceful)', () => {
    const g = createGraph();
    // @ts-expect-error: testing runtime undefined guard
    g.extractFromStyle(undefined);
    expect(g.size).toBe(0);
  });

  it('updates value when same name is re-declared', () => {
    const g = createGraph();
    g.extractFromStyle('--primary: red;');
    g.extractFromStyle('--primary: blue;');
    expect(g.size).toBe(1);
    expect(g.get('--primary')?.value).toBe('blue');
  });

  it('handles multi-line CSS with newlines and indentation', () => {
    const g = createGraph();
    g.extractFromStyle(`
			--color-text: #333333;
			--color-bg: #FFFFFF;
			--color-border: #CCCCCC;
		`);
    expect(g.size).toBe(3);
    expect(g.get('--color-text')?.value).toBe('#333333');
  });
});

// ---------------------------------------------------------------------------
// inferType
// ---------------------------------------------------------------------------

describe('inferType', () => {
  let g: CssVariableGraph;
  beforeEach(() => {
    g = createGraph();
  });

  it('maps color property to TextColor', () => {
    expect(g.inferType('color')).toBe(VarType.TextColor);
  });

  it('maps background-color property to BgColor', () => {
    expect(g.inferType('background-color')).toBe(VarType.BgColor);
  });

  it('maps background property to BgColor | BgImage', () => {
    const result = g.inferType('background');
    expect(result & VarType.BgColor).toBeTruthy();
    expect(result & VarType.BgImage).toBeTruthy();
  });

  it('maps border-color to BorderColor', () => {
    expect(g.inferType('border-color')).toBe(VarType.BorderColor);
  });

  it('maps background-image to BgImage | BgColor', () => {
    const result = g.inferType('background-image');
    expect(result & VarType.BgImage).toBeTruthy();
    expect(result & VarType.BgColor).toBeTruthy();
  });

  it('maps font-family to FontFamily', () => {
    expect(g.inferType('font-family')).toBe(VarType.FontFamily);
  });

  it('returns None for unknown property', () => {
    expect(g.inferType('z-index')).toBe(VarType.None);
  });

  it('returns None for empty property', () => {
    expect(g.inferType('')).toBe(VarType.None);
  });

  it('combines bits for properties appearing in multiple sets', () => {
    // border-top-color is in BORDER_COLOR_PROPS only
    expect(g.inferType('border-top-color')).toBe(VarType.BorderColor);
    // outline-color is also in BORDER_COLOR_PROPS
    expect(g.inferType('outline-color')).toBe(VarType.BorderColor);
  });
});

// ---------------------------------------------------------------------------
// resolveReferences — dependency graph wiring
// ---------------------------------------------------------------------------

describe('resolveReferences', () => {
  it('builds forward and reverse edges for var() references', () => {
    const g = createGraph();
    g.extractFromStyle('--a: var(--b); --b: red;');
    g.resolveReferences();

    const a = g.get('--a')!;
    const b = g.get('--b')!;

    expect(a.dependencies).toContain('--b');
    expect(b.dependents).toContain('--a');
  });

  it('handles multi-level chains: a → b → c', () => {
    const g = createGraph();
    g.extractFromStyle('--a: var(--b); --b: var(--c); --c: green;');
    g.resolveReferences();

    expect(g.get('--a')!.dependencies).toContain('--b');
    expect(g.get('--b')!.dependencies).toContain('--c');
    expect(g.get('--c')!.dependents).toContain('--b');
    expect(g.get('--b')!.dependents).toContain('--a');

    // --a has no direct dependency on --c; only via --b.
    expect(g.get('--a')!.dependencies).not.toContain('--c');
  });

  it('ignores self-references (does not create cycle)', () => {
    const g = createGraph();
    g.extractFromStyle('--self: var(--self);');
    g.resolveReferences();

    expect(g.get('--self')!.dependencies).toHaveLength(0);
    expect(g.get('--self')!.dependents).toHaveLength(0);
  });

  it('does not error on references to undefined variables', () => {
    const g = createGraph();
    g.extractFromStyle('--ref: var(--unknown);');
    // Should not throw.
    expect(() => g.resolveReferences()).not.toThrow();
    expect(g.get('--ref')!.dependencies).toHaveLength(0);
  });

  it('clears old edges before re-wiring on repeated calls', () => {
    const g = createGraph();
    g.extractFromStyle('--a: var(--b); --b: black;');
    g.resolveReferences();

    // Re-extract with different references, then resolve again.
    g.extractFromStyle('--a: var(--c); --c: white;');
    g.resolveReferences();

    const a = g.get('--a')!;
    expect(a.dependencies).toContain('--c');
    expect(a.dependencies).not.toContain('--b');
  });

  it('matches the documented pipeline with usage context inference', () => {
    const g = createGraph();
    g.extractFromStyle(`
			--surface: var(--bg);
			--bg: #141418;
			--text: var(--fg);
			--fg: #FF453A;
		`);
    // Record usage: --surface used for bg, --text used for color.
    g.recordUsage('--surface', 'background-color');
    g.recordUsage('--text', 'color');
    g.resolveReferences();

    expect(g.get('--surface')!.type & VarType.BgColor).toBeTruthy();
    expect(g.get('--text')!.type & VarType.TextColor).toBeTruthy();
    expect(g.get('--bg')!.type & VarType.BgColor).toBeTruthy();
    expect(g.get('--fg')!.type & VarType.TextColor).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// subscribe / unsubscribe
// ---------------------------------------------------------------------------

describe('subscribe', () => {
  it('receives an immediate-style notification when setVariable is called', () => {
    const g = createGraph();
    const received: string[] = [];
    g.extractFromStyle('--primary: red;');
    g.resolveReferences();

    g.subscribe('--primary', (v) => {
      received.push(v.value);
    });

    g.setVariable('--primary', 'blue');
    expect(received).toEqual(['blue']);
  });

  it('does not call unsubscribe after unsubscribe()', () => {
    const g = createGraph();
    g.extractFromStyle('--x: 1;');
    let count = 0;

    const unsub = g.subscribe('--x', () => {
      count++;
    });

    g.setVariable('--x', '2');
    unsub();
    g.setVariable('--x', '3');

    expect(count).toBe(1);
  });

  it('throws in a callback does not prevent other subscribers from firing', () => {
    const g = createGraph();
    g.extractFromStyle('--shared: init;');
    const received: string[] = [];

    g.subscribe('--shared', () => {
      throw new Error('subscriber panic');
    });
    g.subscribe('--shared', (v) => {
      received.push(v.value);
    });

    expect(() => g.setVariable('--shared', 'updated')).not.toThrow();
    expect(received).toEqual(['updated']);
  });

  it('safe to unsubscribe multiple times (idempotent)', () => {
    const g = createGraph();
    g.extractFromStyle('--x: 1;');

    const unsub = g.subscribe('--x', () => {});
    unsub();
    unsub(); // must not throw
  });

  it('notifies dependents when a dependency changes (cascade)', () => {
    const g = createGraph();
    g.extractFromStyle('--base: #000; --derived: var(--base);');
    g.resolveReferences();

    const derivedUpdates: string[] = [];
    g.subscribe('--derived', (v) => {
      derivedUpdates.push(v.value);
    });

    // --derived does not change value, but it subscribed via cascade.
    // The current implementation notifies dependents of any change to
    // the upstream variable — but --derived's *value* is still the same
    // string. The notification fires because --derived is a dependent.
    g.setVariable('--base', '#FFF');

    // The subscriber is on --derived, which is a dependent of --base.
    // The cascade notification should fire for dependents too.
    expect(derivedUpdates.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// setVariable
// ---------------------------------------------------------------------------

describe('setVariable', () => {
  it('creates a new variable if it does not exist', () => {
    const g = createGraph();
    g.setVariable('--new', 'value');
    expect(g.get('--new')).not.toBeNull();
    expect(g.get('--new')!.value).toBe('value');
    expect(g.get('--new')!.type).toBe(VarType.None);
  });

  it('updates lastUpdated timestamp on each call', () => {
    const g = createGraph();
    g.setVariable('--x', '1');
    const t1 = g.get('--x')!.lastUpdated;

    // Ensure clock advances (Date.now() resolution is 1ms; this is safe
    // on Windows which has ~15ms granularity — but we only check >=).
    g.setVariable('--x', '2');
    const t2 = g.get('--x')!.lastUpdated;

    expect(t2).toBeGreaterThanOrEqual(t1);
  });

  it('ignores empty name', () => {
    const g = createGraph();
    g.setVariable('', 'x');
    expect(g.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getByType
// ---------------------------------------------------------------------------

describe('getByType', () => {
  it('returns only variables matching the requested type bit', () => {
    const g = createGraph();
    g.extractFromStyle(`
			--bg: #141418;
			--fg: #FF453A;
			--radius: 4px;
		`);
    g.recordUsage('--bg', 'background-color');
    g.recordUsage('--fg', 'color');
    g.resolveReferences();

    const bgVars = g.getByType(VarType.BgColor);
    const textVars = g.getByType(VarType.TextColor);

    expect(bgVars.map((v) => v.name)).toContain('--bg');
    expect(bgVars.map((v) => v.name)).not.toContain('--fg');

    expect(textVars.map((v) => v.name)).toContain('--fg');
    expect(textVars.map((v) => v.name)).not.toContain('--bg');
  });

  it('returns empty array when no variables match', () => {
    const g = createGraph();
    g.extractFromStyle('--x: 1;');
    g.resolveReferences();
    expect(g.getByType(VarType.FontFamily)).toEqual([]);
  });

  it('returns the same variable when multiple bits match', () => {
    const g = createGraph();
    g.extractFromStyle('--dual: linear-gradient(...);');
    g.recordUsage('--dual', 'background'); // BgColor | BgImage
    g.resolveReferences();

    expect(g.getByType(VarType.BgColor).map((v) => v.name)).toContain('--dual');
    expect(g.getByType(VarType.BgImage).map((v) => v.name)).toContain('--dual');
  });
});

// ---------------------------------------------------------------------------
// clear
// ---------------------------------------------------------------------------

describe('clear', () => {
  it('removes all variables and subscriber wiring', () => {
    const g = createGraph();
    g.extractFromStyle('--a: 1; --b: 2;');
    g.resolveReferences();
    g.subscribe('--a', () => {});

    g.clear();

    expect(g.size).toBe(0);
    expect(g.get('--a')).toBeNull();
    expect(g.get('--b')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Integration / pipeline
// ---------------------------------------------------------------------------

describe('pipeline integration', () => {
  it('simulates the token-extractor → graph → palette flow', () => {
    const g = new CssVariableGraph();

    // Step 1: Extract from a CSS block that looks like a captured agent theme.
    g.extractFromStyle(`
			/* Agent Theme: WorkBuddy Dark */
			--wb-bg-primary: #141418;
			--wb-bg-surface: var(--wb-bg-primary);
			--wb-text-primary: #E0E0E0;
			--wb-text-muted: var(--wb-bg-primary);
			--wb-accent: #FF453A;
			--wb-border: var(--wb-accent);
			--wb-font: "Space Grotesk", sans-serif;
		`);

    // Step 2: Record usage contexts (what CSS property each var appears in).
    g.recordUsage('--wb-bg-surface', 'background-color');
    g.recordUsage('--wb-text-primary', 'color');
    g.recordUsage('--wb-text-muted', 'color');
    g.recordUsage('--wb-accent', 'border-color');
    g.recordUsage('--wb-border', 'border-color');
    g.recordUsage('--wb-bg-primary', 'background-color');
    g.recordUsage('--wb-font', 'font-family');

    // Step 3: Resolve var() edges and infer types.
    g.resolveReferences();

    // Step 4: Query by type.
    const bgVars = g.getByType(VarType.BgColor);
    const textVars = g.getByType(VarType.TextColor);
    const borderVars = g.getByType(VarType.BorderColor);
    const fontVars = g.getByType(VarType.FontFamily);

    // --wb-bg-primary: directly BgColor (recordUsage) + inherits BgColor from
    //   --wb-bg-surface + inherits TextColor from --wb-text-muted (which uses
    //   var(--wb-bg-primary) in a `color` context). So it matches BOTH bg and text.
    expect(bgVars.length).toBe(2); // --wb-bg-primary, --wb-bg-surface
    expect(textVars.length).toBe(3); // --wb-text-primary, --wb-text-muted, --wb-bg-primary (inherited)
    expect(borderVars.length).toBe(2); // --wb-accent, --wb-border
    expect(fontVars.length).toBe(1); // --wb-font

    // Step 5: Dependency wiring is correct.
    expect(g.get('--wb-bg-surface')!.dependencies).toContain('--wb-bg-primary');
    expect(g.get('--wb-border')!.dependencies).toContain('--wb-accent');
    expect(g.get('--wb-bg-primary')!.dependents).toContain('--wb-bg-surface');
  });

  it('handles circular references without infinite loops', () => {
    const g = createGraph();
    g.extractFromStyle('--a: var(--b); --b: var(--a);');
    g.resolveReferences();

    // Circular deps: a depends on b, b depends on a. Neither can cascade
    // infinitely. The visited set in notify() prevents this.
    let notified = 0;
    g.subscribe('--a', () => {
      notified++;
    });

    expect(() => g.setVariable('--b', 'red')).not.toThrow();
    expect(notified).toBeGreaterThanOrEqual(1);
  });
});

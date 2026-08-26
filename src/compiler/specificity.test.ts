// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import {
  AGENT_SPECIFICITY_PROFILES,
  calculateSpecificity,
  guardSpecificity,
  validateSpecificity,
} from './specificity';

// ---------------------------------------------------------------------------
// calculateSpecificity — W3C [a, b, c] tuple
// ---------------------------------------------------------------------------

describe('calculateSpecificity', () => {
  it('returns [0,2,1] for html.agentskin-host-doubao:root', () => {
    const result = calculateSpecificity('html.agentskin-host-doubao:root');
    expect(result).toEqual([0, 2, 1]);
  });

  it('returns [0,2,0] for :root.agentskin-host-codex', () => {
    const result = calculateSpecificity(':root.agentskin-host-codex');
    expect(result).toEqual([0, 2, 0]);
  });

  it('returns [0,1,2] for html.agentskin-host-traework body', () => {
    const result = calculateSpecificity('html.agentskin-host-traework body');
    expect(result).toEqual([0, 1, 2]);
  });

  it('returns [0,1,1] for html.agentskin-host-workbuddy', () => {
    const result = calculateSpecificity('html.agentskin-host-workbuddy');
    expect(result).toEqual([0, 1, 1]);
  });

  it('returns [0,1,1] for body[data-application-name="workbuddy"]', () => {
    const result = calculateSpecificity('body[data-application-name="workbuddy"]');
    expect(result).toEqual([0, 1, 1]);
  });

  it('returns [0,2,1] for html.agentskin-host-qoderwork:root', () => {
    const result = calculateSpecificity('html.agentskin-host-qoderwork:root');
    expect(result).toEqual([0, 2, 1]);
  });

  it('returns [0,2,1] for html.agentskin-host-zcode:root', () => {
    const result = calculateSpecificity('html.agentskin-host-zcode:root');
    expect(result).toEqual([0, 2, 1]);
  });

  it('counts ID selectors in a', () => {
    const result = calculateSpecificity('#main .item');
    expect(result[0]).toBe(1);
    expect(result[1]).toBe(1);
  });

  it('counts pseudo-classes in b', () => {
    const result = calculateSpecificity('a:hover:first-child');
    expect(result[1]).toBe(2);
  });

  it('counts pseudo-elements in c', () => {
    const result = calculateSpecificity('div::before');
    expect(result).toEqual([0, 0, 2]); // div(element) + ::before(pseudo-element)
  });

  it('handles universal selector * (specificity 0)', () => {
    const result = calculateSpecificity('*');
    expect(result).toEqual([0, 0, 0]);
  });

  it('handles compound selector with combinators', () => {
    const result = calculateSpecificity('html.agentskin-host-doubao:root > body .sidebar');
    // html(1c) + .agentskin-host-doubao(1b) + :root(1b) + body(1c) + .sidebar(1b)
    expect(result).toEqual([0, 3, 2]);
  });

  it('handles :root.agentskin-host-codex with extra class exceeding budget', () => {
    // codex maxSpecificity is [0,2,0]; this selector is [0,3,0] (overflow).
    const result = calculateSpecificity(':root.agentskin-host-codex.extra');
    expect(result).toEqual([0, 3, 0]);
  });
});

// ---------------------------------------------------------------------------
// validateSpecificity — budget & ceiling checks
// ---------------------------------------------------------------------------

describe('validateSpecificity', () => {
  it('reports violated=false when CSS is within budget and specificity', () => {
    // codex maxSpecificity [0,2,0]; :root.agentskin-host-codex is [0,2,0] (at ceiling, not over).
    const css = ':root.agentskin-host-codex { --agentskin-accent: #4f46e5 !important; }';
    const profile = AGENT_SPECIFICITY_PROFILES.codex;
    const report = validateSpecificity(css, profile);
    expect(report.violated).toBe(false);
    expect(report.actualBudget).toBe(1);
  });

  it('reports violated=true when CSS exceeds !important budget', () => {
    // Build CSS with 151 !important declarations (codex budget = 150).
    const decls = Array.from(
      { length: 151 },
      (_, i) => `--agentskin-x-${i}: value !important`,
    ).join(';\n');
    const css = `:root.agentskin-host-codex { ${decls}; }`;
    const profile = AGENT_SPECIFICITY_PROFILES.codex;
    const report = validateSpecificity(css, profile);
    expect(report.violated).toBe(true);
    expect(report.actualBudget).toBe(151);
    expect(report.recommendations.some((r) => r.includes('exceeds budget'))).toBe(true);
  });

  it('reports overflow selectors above maxSpecificity', () => {
    // codex maxSpecificity is [0,2,0]; this selector is [0,3,0] (overflow).
    const css = ':root.agentskin-host-codex.extra-class { color: red }';
    const profile = AGENT_SPECIFICITY_PROFILES.codex;
    const report = validateSpecificity(css, profile);
    expect(report.overflowSelectors.length).toBeGreaterThan(0);
    expect(report.violated).toBe(true);
  });

  it('does not flag selectors within maxSpecificity', () => {
    const css = 'html.agentskin-host-doubao:root { color: red }';
    const profile = AGENT_SPECIFICITY_PROFILES.doubao;
    const report = validateSpecificity(css, profile);
    expect(report.overflowSelectors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// guardSpecificity — auto-fix violations
// ---------------------------------------------------------------------------

describe('guardSpecificity', () => {
  it('wraps overflow rules in @layer agentskin when add-layer is first fallback', () => {
    // doubao profile: fallbackOrder = ['add-layer', 'force-important']
    // Use a selector that exceeds doubao maxSpecificity [0,2,1].
    const css = 'html.agentskin-host-doubao:root div { color: red }';
    const profile = AGENT_SPECIFICITY_PROFILES.doubao;
    const { guarded, report } = guardSpecificity(css, profile);
    expect(report.violated).toBe(true);
    expect(guarded).toContain('@layer agentskin');
  });

  it('adds !important when force-important is first fallback', () => {
    // Construct a profile with force-important first.
    const profile = {
      ...AGENT_SPECIFICITY_PROFILES.doubao,
      fallbackOrder: ['force-important'] as Array<'wrap-host' | 'add-layer' | 'force-important'>,
    };
    const css = 'html.agentskin-host-doubao:root div { color: red }';
    const { guarded } = guardSpecificity(css, profile);
    expect(guarded).toContain('!important');
  });

  it('returns CSS unchanged when no violations', () => {
    // :root.agentskin-host-codex is [0,2,0], codex max is [0,2,0] — at ceiling, not over.
    const css = ':root.agentskin-host-codex { color: red }';
    const profile = AGENT_SPECIFICITY_PROFILES.codex;
    const { guarded, report } = guardSpecificity(css, profile);
    expect(report.violated).toBe(false);
    expect(guarded).toBe(css);
  });

  it('does not double-wrap rules already in @layer agentskin', () => {
    const css = `@layer agentskin {
  html.agentskin-host-doubao:root div { color: red }
}`;
    const profile = AGENT_SPECIFICITY_PROFILES.doubao;
    const { guarded } = guardSpecificity(css, profile);
    // Should not add another @layer agentskin wrapper.
    const layerCount = (guarded.match(/@layer agentskin/g) || []).length;
    expect(layerCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// AGENT_SPECIFICITY_PROFILES — default values
// ---------------------------------------------------------------------------

describe('AGENT_SPECIFICITY_PROFILES', () => {
  it('has all 6 adapters', () => {
    const ids = Object.keys(AGENT_SPECIFICITY_PROFILES);
    expect(ids.sort()).toEqual(['codex', 'doubao', 'qoderwork', 'traework', 'workbuddy', 'zcode']);
  });

  it('codex: host-class-only, budget 150, max [0,2,0]', () => {
    const p = AGENT_SPECIFICITY_PROFILES.codex;
    expect(p.scopeStrategy).toBe('host-class-only');
    expect(p.importantBudget).toBe(150);
    expect(p.maxSpecificity).toEqual([0, 2, 0]);
    expect(p.decorationGuard).toBe(false);
  });

  it('doubao: host-root, budget 650, max [0,2,1], decorationGuard true', () => {
    const p = AGENT_SPECIFICITY_PROFILES.doubao;
    expect(p.scopeStrategy).toBe('host-root');
    expect(p.importantBudget).toBe(650);
    expect(p.maxSpecificity).toEqual([0, 2, 1]);
    expect(p.fallbackOrder).toEqual(['add-layer', 'force-important']);
    expect(p.decorationGuard).toBe(true);
  });

  it('qoderwork: host-root, budget 200, max [0,2,1]', () => {
    const p = AGENT_SPECIFICITY_PROFILES.qoderwork;
    expect(p.scopeStrategy).toBe('host-root');
    expect(p.importantBudget).toBe(200);
    expect(p.maxSpecificity).toEqual([0, 2, 1]);
    expect(p.decorationGuard).toBe(false);
  });

  it('zcode: host-root, budget 200, max [0,2,1]', () => {
    const p = AGENT_SPECIFICITY_PROFILES.zcode;
    expect(p.scopeStrategy).toBe('host-root');
    expect(p.importantBudget).toBe(200);
    expect(p.maxSpecificity).toEqual([0, 2, 1]);
    expect(p.decorationGuard).toBe(false);
  });

  it('workbuddy: body-descendant, budget 250, max [0,1,2], decorationGuard true', () => {
    const p = AGENT_SPECIFICITY_PROFILES.workbuddy;
    expect(p.scopeStrategy).toBe('body-descendant');
    expect(p.importantBudget).toBe(250);
    expect(p.maxSpecificity).toEqual([0, 1, 2]);
    expect(p.decorationGuard).toBe(true);
  });

  it('traework: body-descendant, budget 250, max [0,1,2]', () => {
    const p = AGENT_SPECIFICITY_PROFILES.traework;
    expect(p.scopeStrategy).toBe('body-descendant');
    expect(p.importantBudget).toBe(250);
    expect(p.maxSpecificity).toEqual([0, 1, 2]);
    expect(p.decorationGuard).toBe(false);
  });
});

// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import type { ThemeManifest } from '../types/theme';
import {
  collectContractSelectors,
  extractCssSelectors,
  type ProbeResult,
  probeThemeCompatibility,
} from './theme-probe';

// ---------------------------------------------------------------------------
// Helper: create a minimal ThemeManifest for testing
// ---------------------------------------------------------------------------

function createManifest(targets: Record<string, { css: string }> = {}): ThemeManifest {
  return {
    id: 'test-theme',
    name: 'Test Theme',
    version: '1.0.0',
    author: 'Test Author',
    description: null,
    supportedAgents: Object.keys(targets) as ThemeManifest['supportedAgents'],
    preview: null,
    targets,
  };
}

// ---------------------------------------------------------------------------
// extractCssSelectors tests
// ---------------------------------------------------------------------------

describe('extractCssSelectors', () => {
  it('extracts simple class selectors', () => {
    const css = '.sidebar { color: red; }';
    expect(extractCssSelectors(css)).toEqual(['.sidebar']);
  });

  it('extracts multiple comma-separated selectors', () => {
    const css = '.a, .b, .c { color: red; }';
    expect(extractCssSelectors(css)).toEqual(['.a', '.b', '.c']);
  });

  it('extracts compound selectors', () => {
    const css = '.parent .child { color: red; }';
    expect(extractCssSelectors(css)).toEqual(['.parent .child']);
  });

  it('extracts selectors from @media blocks', () => {
    const css = '@media (max-width: 768px) { .sidebar { display: none; } }';
    expect(extractCssSelectors(css)).toEqual(['.sidebar']);
  });

  it('extracts selectors from @supports blocks', () => {
    const css = '@supports (display: grid) { .layout { display: grid; } }';
    expect(extractCssSelectors(css)).toEqual(['.layout']);
  });

  it('strips CSS comments', () => {
    const css = '/* comment */ .visible { color: red; }';
    expect(extractCssSelectors(css)).toEqual(['.visible']);
  });

  it('returns empty array for empty CSS', () => {
    expect(extractCssSelectors('')).toEqual([]);
  });

  it('returns empty array for whitespace-only CSS', () => {
    expect(extractCssSelectors('   \n\t  ')).toEqual([]);
  });

  it('deduplicates repeated selectors', () => {
    const css = '.a { color: red; } .a { background: blue; }';
    expect(extractCssSelectors(css)).toEqual(['.a']);
  });

  it('handles nested @media blocks', () => {
    const css = '@media (min-width: 100px) { @media (max-width: 200px) { .deep { color: red; } } }';
    expect(extractCssSelectors(css)).toEqual(['.deep']);
  });

  it('skips @font-face and @import rules', () => {
    const css =
      '@import url("foo.css"); @font-face { src: url("font.woff2"); } .visible { color: red; }';
    expect(extractCssSelectors(css)).toEqual(['.visible']);
  });
});

// ---------------------------------------------------------------------------
// collectContractSelectors tests
// ---------------------------------------------------------------------------

describe('collectContractSelectors', () => {
  it('collects selectors from required checks', () => {
    const contract = {
      required: [{ name: 'host-class', any: ['html.agentskin-host-test'] }],
      recommended: [],
      contexts: [],
    };
    const selectors = collectContractSelectors(contract);
    expect(selectors.has('html.agentskin-host-test')).toBe(true);
  });

  it('collects selectors from recommended checks', () => {
    const contract = {
      required: [],
      recommended: [{ name: 'bonus', any: ['.bonus-selector'] }],
      contexts: [],
    };
    const selectors = collectContractSelectors(contract);
    expect(selectors.has('.bonus-selector')).toBe(true);
  });

  it('collects selectors from context when clauses', () => {
    const contract = {
      required: [],
      recommended: [],
      contexts: [
        {
          name: 'sidebar-ctx',
          when: { any: ["[class*='sidebar']"] },
          required: [],
        },
      ],
    };
    const selectors = collectContractSelectors(contract);
    expect(selectors.has("[class*='sidebar']")).toBe(true);
  });

  it('collects selectors from context required checks', () => {
    const contract = {
      required: [],
      recommended: [],
      contexts: [
        {
          name: 'sidebar-ctx',
          when: { any: ['.sidebar'] },
          required: [{ name: 'sidebar-themed', any: ['.sidebar[style]'] }],
        },
      ],
    };
    const selectors = collectContractSelectors(contract);
    expect(selectors.has('.sidebar')).toBe(true);
    expect(selectors.has('.sidebar[style]')).toBe(true);
  });

  it('returns empty set for empty contract', () => {
    const contract = { required: [], recommended: [], contexts: [] };
    const selectors = collectContractSelectors(contract);
    expect(selectors.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// probeThemeCompatibility — compatible theme (all nodes exist)
// ---------------------------------------------------------------------------

describe('probeThemeCompatibility — compatible theme', () => {
  it('returns compatible when all selectors are in the contract', () => {
    // traework contract has these selectors:
    //   html.agentskin-host-traework, :root[style*='--agentskin-accent'], etc.
    const manifest = createManifest({
      traework: {
        css: 'html.agentskin-host-traework { --agentskin-accent: #ff0000; }',
      },
    });

    const result = probeThemeCompatibility(manifest, 'traework');

    expect(result.compatible).toBe(true);
    expect(result.missingNodes).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('returns compatible when using universal selectors', () => {
    const manifest = createManifest({
      doubao: {
        css: ':root { --agentskin-bg: #000000; } html { color: white; } body { margin: 0; }',
      },
    });

    const result = probeThemeCompatibility(manifest, 'doubao');

    expect(result.compatible).toBe(true);
    expect(result.missingNodes).toEqual([]);
  });

  it('returns compatible when CSS targets contract selectors for qoderwork', () => {
    const manifest = createManifest({
      qoderwork: {
        css: 'html.agentskin-host-qoderwork { --agentskin-accent: #00ff00; }',
      },
    });

    const result = probeThemeCompatibility(manifest, 'qoderwork');

    expect(result.compatible).toBe(true);
    expect(result.missingNodes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// probeThemeCompatibility — incompatible theme (some nodes missing)
// ---------------------------------------------------------------------------

describe('probeThemeCompatibility — incompatible theme', () => {
  it('reports missing selectors not in the contract', () => {
    const manifest = createManifest({
      traework: {
        css: '.nonexistent-selector { color: red; }',
      },
    });

    const result = probeThemeCompatibility(manifest, 'traework');

    expect(result.compatible).toBe(false);
    expect(result.missingNodes).toContain('.nonexistent-selector');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('reports multiple missing selectors', () => {
    const manifest = createManifest({
      codex: {
        css: '.missing-a { color: red; } .missing-b { background: blue; }',
      },
    });

    const result = probeThemeCompatibility(manifest, 'codex');

    expect(result.compatible).toBe(false);
    expect(result.missingNodes).toContain('.missing-a');
    expect(result.missingNodes).toContain('.missing-b');
  });

  it('does not report universal selectors as missing', () => {
    const manifest = createManifest({
      workbuddy: {
        css: ':root { --agentskin-accent: #ff0000; } .unknown { color: red; }',
      },
    });

    const result = probeThemeCompatibility(manifest, 'workbuddy');

    expect(result.compatible).toBe(false);
    expect(result.missingNodes).not.toContain(':root');
    expect(result.missingNodes).toContain('.unknown');
  });

  it('reports mix of known and unknown selectors', () => {
    const manifest = createManifest({
      zcode: {
        css: 'html.agentskin-host-zcode { --agentskin-accent: #ff0000; } .custom-element { color: blue; }',
      },
    });

    const result = probeThemeCompatibility(manifest, 'zcode');

    expect(result.compatible).toBe(false);
    expect(result.missingNodes).not.toContain('html.agentskin-host-zcode');
    expect(result.missingNodes).toContain('.custom-element');
  });
});

// ---------------------------------------------------------------------------
// probeThemeCompatibility — empty selector list
// ---------------------------------------------------------------------------

describe('probeThemeCompatibility — empty selector list', () => {
  it('returns compatible when targets CSS is empty', () => {
    const manifest = createManifest({
      traework: { css: '' },
    });

    const result = probeThemeCompatibility(manifest, 'traework');

    expect(result.compatible).toBe(true);
    expect(result.missingNodes).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('returns compatible when targets CSS is whitespace only', () => {
    const manifest = createManifest({
      doubao: { css: '   \n\t  ' },
    });

    const result = probeThemeCompatibility(manifest, 'doubao');

    expect(result.compatible).toBe(true);
    expect(result.missingNodes).toEqual([]);
  });

  it('returns compatible when targets field is missing for the agent', () => {
    const manifest = createManifest({});

    const result = probeThemeCompatibility(manifest, 'traework');

    expect(result.compatible).toBe(true);
    expect(result.missingNodes).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('returns compatible when manifest has no targets at all', () => {
    const manifest = {
      id: 'no-targets',
      name: 'No Targets',
      version: '1.0.0',
      author: null,
      description: null,
      supportedAgents: [] as ThemeManifest['supportedAgents'],
      preview: null,
    };

    const result = probeThemeCompatibility(manifest, 'traework');

    expect(result.compatible).toBe(true);
    expect(result.missingNodes).toEqual([]);
  });

  it('returns compatible when CSS contains only comments', () => {
    const manifest = createManifest({
      traework: { css: '/* just a comment */' },
    });

    const result = probeThemeCompatibility(manifest, 'traework');

    expect(result.compatible).toBe(true);
    expect(result.missingNodes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// probeThemeCompatibility — invalid agentId
// ---------------------------------------------------------------------------

describe('probeThemeCompatibility — invalid agentId', () => {
  it('returns incompatible with warning for unknown agent', () => {
    const manifest = createManifest({
      // Using a non-existent agent id cast as any
      unknown_agent: { css: '.something { color: red; }' },
    });

    // Cast to AgentId to test the behavior when no contract exists
    const result = probeThemeCompatibility(
      manifest,
      'invalid_agent' as ThemeManifest['supportedAgents'][number],
    );

    expect(result.compatible).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('invalid_agent');
  });
});

// ---------------------------------------------------------------------------
// ProbeResult type structure
// ---------------------------------------------------------------------------

describe('ProbeResult structure', () => {
  it('has the correct shape', () => {
    const manifest = createManifest({
      traework: { css: '.unknown { color: red; }' },
    });

    const result: ProbeResult = probeThemeCompatibility(manifest, 'traework');

    expect(result).toHaveProperty('compatible');
    expect(result).toHaveProperty('missingNodes');
    expect(result).toHaveProperty('warnings');
    expect(typeof result.compatible).toBe('boolean');
    expect(Array.isArray(result.missingNodes)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
  });
});

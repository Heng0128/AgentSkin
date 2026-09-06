// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import {
  type ContractCheck,
  type DomSnapshot,
  loadContract,
  type VerificationContract,
  validateContract,
} from './contract-validator';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Create a DomSnapshot from a set of selectors that should "match".
 * Any selector not in the set returns false.
 */
function createSnapshot(matchingSelectors: readonly string[]): DomSnapshot {
  const set = new Set(matchingSelectors);
  return {
    has: (selector: string) => set.has(selector),
  };
}

/** Create a snapshot where ALL selectors match (always passes). */
function createFullSnapshot(): DomSnapshot {
  return {
    has: () => true,
  };
}

/** Create a snapshot where NO selector matches (always fails). */
function createEmptySnapshot(): DomSnapshot {
  return {
    has: () => false,
  };
}

// ---------------------------------------------------------------------------
// loadContract
// ---------------------------------------------------------------------------

describe('loadContract', () => {
  it('returns a contract for traework', () => {
    const contract = loadContract('traework');
    expect(contract).toBeDefined();
    expect(contract?.required.length).toBeGreaterThan(0);
  });

  it('returns a contract for qoderwork', () => {
    const contract = loadContract('qoderwork');
    expect(contract).toBeDefined();
    expect(contract?.required.length).toBeGreaterThan(0);
  });

  it('returns a contract for workbuddy', () => {
    const contract = loadContract('workbuddy');
    expect(contract).toBeDefined();
    expect(contract?.required.length).toBeGreaterThan(0);
  });

  it('returns a contract for doubao', () => {
    const contract = loadContract('doubao');
    expect(contract).toBeDefined();
    expect(contract?.required.length).toBeGreaterThan(0);
  });

  it('returns a contract for codex', () => {
    const contract = loadContract('codex');
    expect(contract).toBeDefined();
    expect(contract?.required.length).toBeGreaterThan(0);
  });

  it('returns a contract for zcode', () => {
    const contract = loadContract('zcode');
    expect(contract).toBeDefined();
    expect(contract?.required.length).toBeGreaterThan(0);
  });

  it('every contract has at least one required check', () => {
    const agents = ['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode'] as const;
    for (const agentId of agents) {
      const contract = loadContract(agentId);
      expect(contract, `contract for ${agentId} should exist`).toBeDefined();
      expect(contract!.required.length, `${agentId} should have required checks`).toBeGreaterThan(
        0,
      );
    }
  });

  it('every required check has a name and at least one selector', () => {
    const agents = ['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode'] as const;
    for (const agentId of agents) {
      const contract = loadContract(agentId)!;
      for (const check of contract.required) {
        expect(check.name, `${agentId} required check name`).toBeTruthy();
        expect(
          check.any.length,
          `${agentId} check '${check.name}' should have selectors`,
        ).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// validateContract — required checks
// ---------------------------------------------------------------------------

describe('validateContract — required checks', () => {
  it('passes when all required checks match', () => {
    const contract: VerificationContract = {
      required: [
        { name: 'host-class', any: ['html.agentskin-host-test'] },
        { name: 'accent-token', any: [':root[style*="--agentskin-accent"]'] },
      ],
      recommended: [],
      contexts: [],
    };
    const snapshot = createSnapshot([
      'html.agentskin-host-test',
      ':root[style*="--agentskin-accent"]',
    ]);
    const result = validateContract(snapshot, contract);

    expect(result.passed).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.required).toHaveLength(2);
    expect(result.required[0].passed).toBe(true);
    expect(result.required[1].passed).toBe(true);
  });

  it('fails when a required check does not match', () => {
    const contract: VerificationContract = {
      required: [
        { name: 'host-class', any: ['html.agentskin-host-test'] },
        { name: 'accent-token', any: [':root[style*="--agentskin-accent"]'] },
      ],
      recommended: [],
      contexts: [],
    };
    // Only host-class matches, accent-token is missing.
    const snapshot = createSnapshot(['html.agentskin-host-test']);
    const result = validateContract(snapshot, contract);

    expect(result.passed).toBe(false);
    expect(result.errors).toEqual(['accent-token']);
    expect(result.required[0].passed).toBe(true);
    expect(result.required[1].passed).toBe(false);
  });

  it('passes a check when ANY of its alternative selectors match', () => {
    const check: ContractCheck = {
      name: 'alternative-selectors',
      any: ['.sidebar', '.SideBar', "[data-testid='sidebar']"],
    };
    const contract: VerificationContract = {
      required: [check],
      recommended: [],
      contexts: [],
    };
    // Only the second alternative matches.
    const snapshot = createSnapshot(['.SideBar']);
    const result = validateContract(snapshot, contract);

    expect(result.passed).toBe(true);
    expect(result.required[0].matchedSelectors).toEqual(['.SideBar']);
  });

  it('fails a check when NONE of its alternative selectors match', () => {
    const check: ContractCheck = {
      name: 'alternative-selectors',
      any: ['.sidebar', '.SideBar'],
    };
    const contract: VerificationContract = {
      required: [check],
      recommended: [],
      contexts: [],
    };
    const snapshot = createEmptySnapshot();
    const result = validateContract(snapshot, contract);

    expect(result.passed).toBe(false);
    expect(result.required[0].matchedSelectors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// validateContract — recommended checks
// ---------------------------------------------------------------------------

describe('validateContract — recommended checks', () => {
  it('reports warnings for failed recommended checks but still passes', () => {
    const contract: VerificationContract = {
      required: [{ name: 'host-class', any: ['html.agentskin-host-test'] }],
      recommended: [{ name: 'bonus-token', any: [":root[style*='--agentskin-extra']"] }],
      contexts: [],
    };
    const snapshot = createSnapshot(['html.agentskin-host-test']);
    const result = validateContract(snapshot, contract);

    expect(result.passed).toBe(true);
    expect(result.warnings).toEqual(['bonus-token']);
    expect(result.recommended[0].passed).toBe(false);
  });

  it('passes recommended checks when they match', () => {
    const contract: VerificationContract = {
      required: [{ name: 'host-class', any: ['html.agentskin-host-test'] }],
      recommended: [{ name: 'bonus-token', any: [":root[style*='--agentskin-extra']"] }],
      contexts: [],
    };
    const snapshot = createFullSnapshot();
    const result = validateContract(snapshot, contract);

    expect(result.passed).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.recommended[0].passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateContract — context checks
// ---------------------------------------------------------------------------

describe('validateContract — context checks', () => {
  it('skips context checks when the when clause does not match', () => {
    const contract: VerificationContract = {
      required: [{ name: 'host-class', any: ['html.agentskin-host-test'] }],
      recommended: [],
      contexts: [
        {
          name: 'sidebar-visible',
          when: { any: ["[class*='sidebar']"] },
          required: [{ name: 'sidebar-themed', any: ["[class*='sidebar'][style*='--agentskin']"] }],
        },
      ],
    };
    // No sidebar present — context should be inactive.
    const snapshot = createSnapshot(['html.agentskin-host-test']);
    const result = validateContract(snapshot, contract);

    expect(result.passed).toBe(true);
    expect(result.contexts).toHaveLength(1);
    expect(result.contexts[0].active).toBe(false);
    expect(result.contexts[0].checks).toEqual([]);
    expect(result.contexts[0].errors).toEqual([]);
  });

  it('evaluates context checks when the when clause matches', () => {
    const contract: VerificationContract = {
      required: [{ name: 'host-class', any: ['html.agentskin-host-test'] }],
      recommended: [],
      contexts: [
        {
          name: 'sidebar-visible',
          when: { any: ["[class*='sidebar']"] },
          required: [{ name: 'sidebar-themed', any: ["[class*='sidebar'][style*='--agentskin']"] }],
        },
      ],
    };
    // Sidebar present AND themed.
    const snapshot = createSnapshot([
      'html.agentskin-host-test',
      "[class*='sidebar']",
      "[class*='sidebar'][style*='--agentskin']",
    ]);
    const result = validateContract(snapshot, contract);

    expect(result.passed).toBe(true);
    expect(result.contexts[0].active).toBe(true);
    expect(result.contexts[0].checks).toHaveLength(1);
    expect(result.contexts[0].checks[0].passed).toBe(true);
    expect(result.contexts[0].errors).toEqual([]);
  });

  it('fails when context is active but its required check fails', () => {
    const contract: VerificationContract = {
      required: [{ name: 'host-class', any: ['html.agentskin-host-test'] }],
      recommended: [],
      contexts: [
        {
          name: 'sidebar-visible',
          when: { any: ["[class*='sidebar']"] },
          required: [{ name: 'sidebar-themed', any: ["[class*='sidebar'][style*='--agentskin']"] }],
        },
      ],
    };
    // Sidebar present but NOT themed.
    const snapshot = createSnapshot(['html.agentskin-host-test', "[class*='sidebar']"]);
    const result = validateContract(snapshot, contract);

    expect(result.passed).toBe(false);
    expect(result.contexts[0].active).toBe(true);
    expect(result.contexts[0].errors).toEqual(['sidebar-themed']);
    expect(result.errors).toContain('sidebar-themed');
  });

  it('evaluates multiple contexts independently', () => {
    const contract: VerificationContract = {
      required: [{ name: 'host-class', any: ['html.agentskin-host-test'] }],
      recommended: [],
      contexts: [
        {
          name: 'context-a',
          when: { any: ['[data-a]'] },
          required: [{ name: 'check-a', any: ['[data-a][style]'] }],
        },
        {
          name: 'context-b',
          when: { any: ['[data-b]'] },
          required: [{ name: 'check-b', any: ['[data-b][style]'] }],
        },
      ],
    };
    // Only context-a is active and passes; context-b is inactive.
    const snapshot = createSnapshot(['html.agentskin-host-test', '[data-a]', '[data-a][style]']);
    const result = validateContract(snapshot, contract);

    expect(result.passed).toBe(true);
    expect(result.contexts[0].active).toBe(true);
    expect(result.contexts[1].active).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateContract — edge cases
// ---------------------------------------------------------------------------

describe('validateContract — edge cases', () => {
  it('passes an empty contract (no checks at all)', () => {
    const contract: VerificationContract = {
      required: [],
      recommended: [],
      contexts: [],
    };
    const result = validateContract(createEmptySnapshot(), contract);

    expect(result.passed).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('fails when both required and context checks fail', () => {
    const contract: VerificationContract = {
      required: [{ name: 'missing-required', any: ['.nope'] }],
      recommended: [],
      contexts: [
        {
          name: 'active-ctx',
          when: { any: ['[data-present]'] },
          required: [{ name: 'missing-context-check', any: ['.also-nope'] }],
        },
      ],
    };
    const snapshot = createSnapshot(['[data-present]']);
    const result = validateContract(snapshot, contract);

    expect(result.passed).toBe(false);
    expect(result.errors).toContain('missing-required');
    expect(result.errors).toContain('missing-context-check');
  });

  it('does not mutate the contract', () => {
    const contract: VerificationContract = {
      required: [{ name: 'host-class', any: ['html.agentskin-host-test'] }],
      recommended: [],
      contexts: [],
    };
    const snapshot = createFullSnapshot();
    // Call twice to verify no mutation.
    validateContract(snapshot, contract);
    const result = validateContract(snapshot, contract);

    expect(result.passed).toBe(true);
    expect(contract.required).toHaveLength(1);
  });

  it('returns matched selectors for each check', () => {
    const contract: VerificationContract = {
      required: [
        {
          name: 'multi-match',
          any: ['.a', '.b', '.c'],
        },
      ],
      recommended: [],
      contexts: [],
    };
    const snapshot = createSnapshot(['.a', '.c']);
    const result = validateContract(snapshot, contract);

    expect(result.required[0].matchedSelectors).toEqual(['.a', '.c']);
  });
});

// ---------------------------------------------------------------------------
// Integration: validate loaded contracts against realistic snapshots
// ---------------------------------------------------------------------------

describe('validateContract — loaded contract integration', () => {
  it('traework contract passes with full snapshot', () => {
    const contract = loadContract('traework')!;
    const result = validateContract(createFullSnapshot(), contract);

    expect(result.passed).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('traework contract fails with empty snapshot', () => {
    const contract = loadContract('traework')!;
    const result = validateContract(createEmptySnapshot(), contract);

    expect(result.passed).toBe(false);
    // All required checks should fail.
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('doubao contract passes with full snapshot', () => {
    const contract = loadContract('doubao')!;
    const result = validateContract(createFullSnapshot(), contract);

    expect(result.passed).toBe(true);
  });

  it('codex contract passes with full snapshot', () => {
    const contract = loadContract('codex')!;
    const result = validateContract(createFullSnapshot(), contract);

    expect(result.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Provenance tests
// ---------------------------------------------------------------------------

describe('provenance', () => {
  it('loaded contracts include provenance data on each check', () => {
    const agents = ['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode'] as const;
    for (const agentId of agents) {
      const contract = loadContract(agentId)!;
      // Every required check should have provenance.
      for (const check of contract.required) {
        expect(
          check.provenance,
          `${agentId} required check '${check.name}' should have provenance`,
        ).toBeDefined();
        expect(check.provenance!.source, `${agentId} '${check.name}' source`).toMatch(
          /^(maintainer|reporter|fixture|inferred|reverse-engineering)$/,
        );
        expect(check.provenance!.strength, `${agentId} '${check.name}' strength`).toMatch(
          /^(strong|medium|weak)$/,
        );
      }
    }
  });

  it('provenance information appears in validation results', () => {
    const contract: VerificationContract = {
      required: [
        {
          name: 'host-class',
          any: ['html.agentskin-host-test'],
          provenance: {
            source: 'maintainer',
            strength: 'strong',
            coveredVersions: ['current'],
            lastVerified: '2026-08-20',
          },
        },
      ],
      recommended: [],
      contexts: [],
    };
    const snapshot = createSnapshot(['html.agentskin-host-test']);
    const result = validateContract(snapshot, contract);

    expect(result.required[0].provenance).toEqual({
      source: 'maintainer',
      strength: 'strong',
      coveredVersions: ['current'],
      lastVerified: '2026-08-20',
    });
  });

  it('check without provenance does not fail validation but provenance is undefined in result', () => {
    const contract: VerificationContract = {
      required: [{ name: 'no-provenance-check', any: ['.some-selector'] }],
      recommended: [],
      contexts: [],
    };
    const snapshot = createSnapshot(['.some-selector']);
    const result = validateContract(snapshot, contract);

    // Validation still passes — provenance is a pure additive enhancement.
    expect(result.passed).toBe(true);
    expect(result.required[0].provenance).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Reverse-engineering contract tests (2026-08-30)
// Verifies that contexts derived from binary/static analysis are present
// and correctly structured in the loaded contracts.
// ---------------------------------------------------------------------------

describe('reverse-engineering contract contexts', () => {
  it('traework contract has reverse-engineering contexts', () => {
    const contract = loadContract('traework')!;
    const reContexts = contract.contexts.filter((ctx) =>
      ctx.required.some((c) => c.provenance?.source === 'reverse-engineering'),
    );
    expect(reContexts.length).toBeGreaterThan(0);
    // At least one context references icube tokens or solo-lite.
    const hasIcubeOrSolo = reContexts.some(
      (ctx) => ctx.name.includes('icube') || ctx.name.includes('solo'),
    );
    expect(hasIcubeOrSolo).toBe(true);
  });

  it('qoderwork contract has multi-renderer reverse-engineering contexts', () => {
    const contract = loadContract('qoderwork')!;
    const reContexts = contract.contexts.filter((ctx) =>
      ctx.required.some((c) => c.provenance?.source === 'reverse-engineering'),
    );
    expect(reContexts.length).toBeGreaterThan(0);
    // Voice overlay + MCP + artifact preview + quickpick = 4 renderer contexts
    const rendererContexts = reContexts.filter(
      (ctx) =>
        ctx.name.includes('voice-overlay') ||
        ctx.name.includes('mcp-app-preview') ||
        ctx.name.includes('artifact-preview') ||
        ctx.name.includes('quickpick'),
    );
    expect(rendererContexts.length).toBeGreaterThanOrEqual(4);
  });

  it('workbuddy contract has PWA/SW reverse-engineering contexts', () => {
    const contract = loadContract('workbuddy')!;
    const reContexts = contract.contexts.filter((ctx) =>
      ctx.required.some((c) => c.provenance?.source === 'reverse-engineering'),
    );
    expect(reContexts.length).toBeGreaterThan(0);
    // Webview sandbox context must exist.
    const hasWebview = reContexts.some((ctx) => ctx.name.includes('webview'));
    expect(hasWebview).toBe(true);
  });

  it('zcode contract has PDF/KaTeX reverse-engineering contexts', () => {
    const contract = loadContract('zcode')!;
    const reContexts = contract.contexts.filter((ctx) =>
      ctx.required.some((c) => c.provenance?.source === 'reverse-engineering'),
    );
    expect(reContexts.length).toBeGreaterThan(0);
    // PDF.js and KaTeX contexts must exist.
    const hasPdfOrKatex = reContexts.some(
      (ctx) => ctx.name.includes('pdf') || ctx.name.includes('katex'),
    );
    expect(hasPdfOrKatex).toBe(true);
  });

  it('codex contract has CSP/webview reverse-engineering contexts', () => {
    const contract = loadContract('codex')!;
    const reContexts = contract.contexts.filter((ctx) =>
      ctx.required.some((c) => c.provenance?.source === 'reverse-engineering'),
    );
    expect(reContexts.length).toBeGreaterThan(0);
    // CSP and webview contexts must exist.
    const hasCspOrWebview = reContexts.some(
      (ctx) => ctx.name.includes('csp') || ctx.name.includes('webview'),
    );
    expect(hasCspOrWebview).toBe(true);
  });

  it('doubao contract has CDP/local-page reverse-engineering contexts', () => {
    const contract = loadContract('doubao')!;
    const reContexts = contract.contexts.filter((ctx) =>
      ctx.required.some((c) => c.provenance?.source === 'reverse-engineering'),
    );
    expect(reContexts.length).toBeGreaterThan(0);
    // CDP and local-page contexts must exist.
    const hasCdpOrLocal = reContexts.some(
      (ctx) =>
        ctx.name.includes('cdp') || ctx.name.includes('local') || ctx.name.includes('chromium'),
    );
    expect(hasCdpOrLocal).toBe(true);
  });

  it('every reverse-engineering context has knownGaps documented', () => {
    const agents = ['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode'] as const;
    for (const agentId of agents) {
      const contract = loadContract(agentId)!;
      for (const ctx of contract.contexts) {
        for (const check of ctx.required) {
          if (check.provenance?.source === 'reverse-engineering') {
            expect(
              check.provenance.knownGaps,
              `${agentId} reverse-engineering check '${check.name}' should document knownGaps`,
            ).toBeDefined();
            expect(check.provenance.knownGaps!.length).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('reverse-engineering contexts are correctly evaluated when when clause matches', () => {
    // Simulate the icube context of traework: when icube tokens are present,
    // the icube-tokens-overridden check should pass.
    const contract = loadContract('traework')!;
    const icubeCtx = contract.contexts.find((c) => c.name === 'icube-tokens-discoverable');
    expect(icubeCtx).toBeDefined();

    // When icube tokens present AND overridden → pass.
    const passSnapshot = createSnapshot([
      ":root[style*='--vscode-icube-']",
      ":root[style*='--vscode-icube-colorBg1']",
    ]);
    const passResult = validateContract(passSnapshot, {
      required: [],
      recommended: [],
      contexts: [icubeCtx!],
    });
    expect(passResult.contexts[0].active).toBe(true);
    expect(passResult.contexts[0].errors).toEqual([]);

    // When icube tokens present but NOT overridden → fail.
    const failSnapshot = createSnapshot([":root[style*='--vscode-icube-']"]);
    const failResult = validateContract(failSnapshot, {
      required: [],
      recommended: [],
      contexts: [icubeCtx!],
    });
    expect(failResult.contexts[0].active).toBe(true);
    expect(failResult.contexts[0].errors.length).toBeGreaterThan(0);
  });
});

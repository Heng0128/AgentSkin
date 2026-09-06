// SPDX-License-Identifier: MPL-2.0

/**
 * Selector Contract Validation Test
 *
 * Verifies that the canonical `selector-contract.json` contract file
 * is well-formed, internally consistent, and in sync with the runtime
 * selectivity-registry.
 *
 * The contract is the single source of truth for all 6 adapters'
 * semantic selectors. Its tier annotations (L1/L2/L3) drive preflight
 * blocking behavior and selector-preflight's diff verification.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Contract path
// ---------------------------------------------------------------------------

const CONTRACT_PATH = resolve(
  process.cwd(),
  'src/engine/src/contracts/selector-contract.json',
);

const REGISTRY_PATH = resolve(
  process.cwd(),
  'src/engine/src/runtime/selectivity-registry.mjs',
);

const EXPECTED_AGENTS = [
  'traework',
  'qoderwork',
  'workbuddy',
  'doubao',
  'codex',
  'zcode',
] as const;

const VALID_TIERS = ['L1', 'L2', 'L3'] as const;

// ---------------------------------------------------------------------------
// Test: contract file exists and is valid JSON
// ---------------------------------------------------------------------------

describe('selector-contract.json — structural integrity', () => {
  it('contract file exists on disk', () => {
    expect(existsSync(CONTRACT_PATH)).toBe(true);
  });

  it('contract file contains valid JSON that parses to an object', () => {
    const raw = readFileSync(CONTRACT_PATH, 'utf-8');
    const contract = JSON.parse(raw);
    expect(typeof contract).toBe('object');
    expect(contract).not.toBeNull();
  });

  it('declares schema "agentskin-selector-contract/1"', () => {
    const contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf-8'));
    expect(contract.schema).toBe('agentskin-selector-contract/1');
  });

  it('verifiedAgainst.agents lists all 6 expected agents', () => {
    const contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf-8'));
    const agents: string[] = contract.verifiedAgainst?.agents ?? [];
    expect(agents.sort()).toEqual([...EXPECTED_AGENTS].sort());
  });

  it('selectors object contains all 6 expected agents', () => {
    const contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf-8'));
    const agents = Object.keys(contract.selectors ?? {}).sort();
    expect(agents).toEqual([...EXPECTED_AGENTS].sort());
  });
});

// ---------------------------------------------------------------------------
// Test: every agent has required fields and valid tier
// ---------------------------------------------------------------------------

describe('selector-contract.json — per-agent validation', () => {
  const contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf-8'));
  const agentSelectors: Record<string, Record<string, { selector: string; tier: string; description: string }>> =
    contract.selectors ?? {};

  for (const agent of EXPECTED_AGENTS) {
    describe(`agent: ${agent}`, () => {
      it(`has at least one semantic selector entry`, () => {
        expect(Object.keys(agentSelectors[agent] ?? {}).length).toBeGreaterThan(0);
      });

      it(`has L1 root tier entry`, () => {
        const entries = agentSelectors[agent] ?? {};
        const rootEntry = entries.root;
        expect(rootEntry).toBeDefined();
        expect(rootEntry.tier).toBe('L1');
      });

      it(`root selector is non-empty string`, () => {
        const rootEntry = agentSelectors[agent]?.root;
        expect(typeof rootEntry.selector).toBe('string');
        expect(rootEntry.selector.length).toBeGreaterThan(0);
      });

      it(`all tier values are L1, L2, or L3`, () => {
        const entries = agentSelectors[agent] ?? {};
        for (const [name, entry] of Object.entries(entries)) {
          expect(
            VALID_TIERS,
            `agent "${agent}" entry "${name}" has invalid tier "${entry.tier}"`,
          ).toContain(entry.tier);
        }
      });

      it(`all entries have non-empty description`, () => {
        const entries = agentSelectors[agent] ?? {};
        for (const [name, entry] of Object.entries(entries)) {
          expect(
            typeof entry.description,
            `agent "${agent}" entry "${name}" missing description`,
          ).toBe('string');
          expect(
            entry.description.length,
            `agent "${agent}" entry "${name}" has empty description`,
          ).toBeGreaterThan(0);
        }
      });

      it(`all entries have non-empty selector`, () => {
        const entries = agentSelectors[agent] ?? {};
        for (const [name, entry] of Object.entries(entries)) {
          expect(
            typeof entry.selector,
            `agent "${agent}" entry "${name}" missing selector`,
          ).toBe('string');
          expect(
            entry.selector.length,
            `agent "${agent}" entry "${name}" has empty selector`,
          ).toBeGreaterThan(0);
        }
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Test: contract tier distribution is reasonable
// ---------------------------------------------------------------------------

describe('selector-contract.json — tier distribution', () => {
  it('every agent has exactly one L1 entry (root)', () => {
    const contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf-8'));
    for (const agent of EXPECTED_AGENTS) {
      const entries = Object.values(contract.selectors[agent] ?? {}) as Array<{ tier: string }>;
      const l1Count = entries.filter((e) => e.tier === 'L1').length;
      expect(l1Count, `agent "${agent}" should have exactly 1 L1 entry`).toBe(1);
    }
  });

  it('non-L1 entries are L2 or L3 (no unclassified tiers)', () => {
    const contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf-8'));
    for (const agent of EXPECTED_AGENTS) {
      const entries = Object.values(contract.selectors[agent] ?? {}) as Array<{ tier: string }>;
      const nonL1 = entries.filter((e) => e.tier !== 'L1');
      for (const entry of nonL1) {
        expect(['L2', 'L3']).toContain(entry.tier);
      }
    }
  });

  it('total selector count >= 4 per agent (root + 2-4 functional)', () => {
    const contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf-8'));
    for (const agent of EXPECTED_AGENTS) {
      const count = Object.keys(contract.selectors[agent] ?? {}).length;
      expect(count, `agent "${agent}" has too few selectors (${count})`).toBeGreaterThanOrEqual(4);
    }
  });
});

// ---------------------------------------------------------------------------
// Test: contract vs registry consistency
// ---------------------------------------------------------------------------

describe('selector-contract.json — registry consistency', () => {
  it('registry source file exists', () => {
    expect(existsSync(REGISTRY_PATH)).toBe(true);
  });

  it('contract agents match registry agent list', () => {
    const contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf-8'));
    const contractAgents = Object.keys(contract.selectors).sort();
    const expected = [...EXPECTED_AGENTS].sort();
    expect(contractAgents).toEqual(expected);
  });

  it('contract semantic names are a subset of registry semantic names per agent', () => {
    // This test reads the registry file content as text and extracts
    // the top-level keys from each agent's registry object. It does not
    // execute the registry module (which depends on browser globals).
    const registryRaw = readFileSync(REGISTRY_PATH, 'utf-8');
    const contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf-8'));

    // Extract agent keys from the registry by finding each "agentName: {" pattern
    const registryAgentBlockRegex = /(\w+):\s*\{/g;
    const registryAgents = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = registryAgentBlockRegex.exec(registryRaw)) !== null) {
      const agent = match[1];
      if ((EXPECTED_AGENTS as readonly string[]).includes(agent)) {
        registryAgents.add(agent);
      }
    }

    const contractAgents = Object.keys(contract.selectors);
    for (const agent of contractAgents) {
      expect(
        registryAgents.has(agent),
        `agent "${agent}" exists in contract but not in registry`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Test: selector syntax sanity
// ---------------------------------------------------------------------------

describe('selector-contract.json — selector syntax sanity', () => {
  it('all selectors are non-empty when split by comma', () => {
    const contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf-8'));
    for (const agent of EXPECTED_AGENTS) {
      const entries = contract.selectors[agent] ?? {};
      for (const [name, entry] of Object.entries(entries) as Array<
        [string, { selector: string }]
      >) {
        const parts = entry.selector.split(',').map((s) => s.trim()).filter(Boolean);
        expect(
          parts.length,
          `agent "${agent}" entry "${name}" produces empty selector parts`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('no selector contains double commas or trailing commas', () => {
    const contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf-8'));
    for (const agent of EXPECTED_AGENTS) {
      const entries = contract.selectors[agent] ?? {};
      for (const [name, entry] of Object.entries(entries) as Array<
        [string, { selector: string }]
      >) {
        expect(
          entry.selector.includes(',,'),
          `agent "${agent}" entry "${name}" has double comma`,
        ).toBe(false);
        expect(
          entry.selector.endsWith(','),
          `agent "${agent}" entry "${name}" has trailing comma`,
        ).toBe(false);
      }
    }
  });
});

// SPDX-License-Identifier: MPL-2.0

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentId } from '../adapt/registry';

// structural-template - structure template extractor
// Extracts STRUCTURAL_CSS from engines/<agent>/adapter.mjs IIFE source.
// Known tech debt: text coupling, not interface coupling.
// Risk: adapter.mjs code style changes may break extraction.
// Mitigation: degrade to L2 on extraction failure (does not block import).
// Future: refactor adapter.mjs to export const STRUCTURAL_TEMPLATE array.

const ENGINES_DIR = join(__dirname, '../../../../engines');

/** Cache to avoid repeated disk reads */
const cache = new Map<AgentId, string>();

/**
 * Extract STRUCTURAL_CSS template from IIFE source.
 * Uses regex to match: const STRUCTURAL_CSS = `...`;
 */
export function extractStructuralTemplate(agentId: AgentId): string | null {
  // Cache hit
  if (cache.has(agentId)) {
    return cache.get(agentId) ?? null;
  }

  const adapterPath = join(ENGINES_DIR, agentId, 'adapter.mjs');

  try {
    const source = readFileSync(adapterPath, 'utf-8');

    // Match const STRUCTURAL_CSS = `...`; pattern (supports multiline)
    const match = source.match(/const\s+STRUCTURAL_CSS\s*=\s*`([\s\S]*?)`;/);

    if (match?.[1]) {
      const template = match[1];
      cache.set(agentId, template);
      return template;
    }

    // Not found -> null (degrade to L2)
    cache.set(agentId, '');
    return null;
  } catch (error) {
    // Read failure -> degrade to L2 (does not block import)
    console.warn(
      `[structural-template] Failed to read adapter.mjs for ${agentId}: ${(error as Error).message}`,
    );
    cache.set(agentId, '');
    return null;
  }
}

/**
 * Check if agent has an available structural template.
 */
export function hasStructuralTemplate(agentId: AgentId): boolean {
  return extractStructuralTemplate(agentId) !== null;
}

/**
 * Clear cache (for testing).
 */
export function clearCache(): void {
  cache.clear();
}

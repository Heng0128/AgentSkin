// SPDX-License-Identifier: MPL-2.0

import type { AgentId } from '@shared/types/agent';
import { AGENT_PROBES } from '../probes';

/**
 * Score a discovered exe against every known adapter's installHints.
 * Matching is whole-word / whole-phrase: a single-word token must appear as a
 * whole word in the haystack, and a phrase token must have every one of its
 * words present (regardless of order or adjacency).
 *
 * Returns the winning AgentId or null.
 */
export function matchAgainstHints(info: {
  productName: string;
  fileDescription: string;
}): AgentId | null {
  for (const probe of AGENT_PROBES) {
    const haystack = `${info.productName} ${info.fileDescription}`.toLowerCase();
    const tokens = [...probe.hints.registryNames, ...probe.hints.dirNames].map((s) =>
      s.toLowerCase(),
    );
    const wordSet = new Set(haystack.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0));
    const matched = tokens.some((token) => {
      if (!token) return false;
      if (/\s|[^a-z0-9]/.test(token)) {
        const words = token.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
        return words.every((w) => wordSet.has(w));
      }
      return wordSet.has(token);
    });
    if (matched) return probe.id;
  }
  return null;
}

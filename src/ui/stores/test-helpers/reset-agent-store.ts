// SPDX-License-Identifier: MPL-2.0

/**
 * # reset-agent-store — shared reset helper for agentStore tests
 *
 * Restores `useAgentStore` to its initial state (with fallback agents).
 * Import this helper in agentStore test files instead of defining local
 * `resetStore` functions.
 */

import { useAgentStore } from '../agentStore';
import { FALLBACK_AGENTS } from '../agentStore';

/** Reset `useAgentStore` to its initial state (with fallback agents). */
export function resetAgentStore(): void {
  useAgentStore.setState({
    agents: FALLBACK_AGENTS,
    loaded: false,
  });
}

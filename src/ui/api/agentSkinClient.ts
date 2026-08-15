// SPDX-License-Identifier: MPL-2.0

/**
 * # agentSkinClient
 *
 * Typed wrapper over `window.agentSkin` (the contextBridge surface exposed
 * by preload.ts). Hooks import the `api` singleton instead of touching
 * `window.agentSkin` directly so that:
 *
 *   1. Every IPC call has a single import path — easier to grep, mock, or
 *      instrument.
 *   2. The surface is documented in one place via the {@link AgentSkinApi}
 *      contract in `shared/types.ts` (no duplicated method list to drift).
 *   3. Future concerns (request de-duplication, cancel tokens, structured
 *      error logging) have a single chokepoint to live in.
 *
 * The wrapper is intentionally stateless and side-effect-free beyond the
 * underlying IPC call — hooks retain their own state/error handling.
 *
 * Testability: hooks that import `api` can be unit-tested by injecting a
 * mock `AgentSkinApi` (replace the `api` singleton with a stub via module
 * mock or a Context provider). Touching `window.agentSkin` directly made
 * this impossible.
 */

import type { AgentSkinApi } from '@shared/types';

/**
 * The typed client. Mirrors {@link AgentSkinApi} exactly — declared as an
 * empty `extends` so the contract lives in ONE place (`shared/types.ts`)
 * and any drift between the preload bridge and the client surfaces as a
 * compile error there.
 */
export interface AgentSkinClient extends AgentSkinApi {}

/**
 * Returns the typed client backed by the global `window.agentSkin`.
 * Throws if the preload bridge is missing (dev-time misconfiguration).
 */
export function getAgentSkinClient(): AgentSkinClient {
  if (!('agentSkin' in window) || !window.agentSkin) {
    throw new Error(
      'window.agentSkin is not exposed — preload.ts failed to register the contextBridge',
    );
  }
  return window.agentSkin as AgentSkinClient;
}

let _apiCache: AgentSkinClient | null = null;

function getApiCached(): AgentSkinClient {
  if (!_apiCache) _apiCache = getAgentSkinClient();
  return _apiCache;
}

/**
 * Singleton accessor — the same IPC bridge for every caller. Hooks import
 * `api` instead of touching `window.agentSkin` directly.
 *
 * Implemented as a Proxy so that module-load time does NOT eagerly evaluate
 * `window.agentSkin`.  This prevents Vite-HMR transform-time crashes
 * (HTTP 500 on import) when the preload bridge has not yet been established.
 * All existing `api.method(...)` call-sites remain untouched.
 */
export const api: AgentSkinClient = new Proxy({} as AgentSkinClient, {
  get(_t, prop) {
    return getApiCached()[prop as keyof AgentSkinClient];
  },
});

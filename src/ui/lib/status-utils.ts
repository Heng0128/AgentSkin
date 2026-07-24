// SPDX-License-Identifier: MPL-2.0

import type { AgentId, AppStatus, SystemStatus } from '@shared/types';

/**
 * Find an app's status within a SystemStatus by agent id.
 *
 * Single source of truth for this lookup — previously duplicated as
 * `appStatusFor` useCallback wrappers in useAgents/useThemes and inlined in
 * useEnvironments. As a pure function it needs no memoization key beyond
 * `status` itself, so callers can use it directly inside useMemo/useCallback
 * without adding extra deps.
 */
export function findAppStatus(
  status: SystemStatus | null,
  appId: AgentId,
): AppStatus | null {
  return status?.apps.find((app) => app.appId === appId) ?? null;
}

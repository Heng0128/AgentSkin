// SPDX-License-Identifier: MPL-2.0

/**
 * # handleApplyResult
 *
 * Pure classifier for an ApplyResponse IPC result, decoupling the three
 * apply outcomes (success / requires-restart / port-occupied) from the
 * state-mutation concerns in useThemes.
 *
 * The caller remains responsible for setStatus/setRestartPrompt/showToast —
 * this function only decides WHICH of those should fire, so the three-way
 * branch is unit-testable in isolation.
 */

import type { ApplyResponse, AgentId } from '@shared/types';

export type ApplyOutcome =
  | { kind: 'success' }
  | { kind: 'requires-restart'; themeId: string; themeName: string; appId: AgentId; restartReason?: ApplyResponse['restartReason'] }
  | { kind: 'port-occupied'; message: string };

/**
 * Map an IPC ApplyResponse to a typed ApplyOutcome.
 *
 * @param result  The ApplyResponse returned by `window.agentSkin.applyTheme`.
 * @param ctx     Identifiers needed for the restart-prompt branch.
 */
export function handleApplyResult(
  result: ApplyResponse,
  ctx: { themeId: string; themeName: string; appId: AgentId },
): ApplyOutcome {
  switch (result.status) {
    case 'requires-restart':
      return { kind: 'requires-restart', ...ctx, restartReason: result.restartReason };
    case 'port-occupied':
      return { kind: 'port-occupied', message: result.message };
    case 'applied':
      return { kind: 'success' };
  }
}

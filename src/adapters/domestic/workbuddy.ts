// SPDX-License-Identifier: MPL-2.0

import { AGENT_META } from '../../shared/types';
import { BaseApplicationAdapter, type InstallHints } from '../base';

/**
 * WorkBuddy — active adapter backed by @agentskin/engine's "workbuddy" adapter.
 */
export class WorkbuddyAdapter extends BaseApplicationAdapter {
  readonly id = 'workbuddy';
  readonly name = AGENT_META.workbuddy.displayName;
  readonly type = 'agent' as const;
  readonly tier = 'active' as const;
  readonly coreId = 'workbuddy';

  /** AgentSkin-side install detection hints (Windows). */
  override readonly installHints: InstallHints = {
    dirNames: ['WorkBuddy'],
    exeNames: ['WorkBuddy.exe'],
    registryNames: ['WorkBuddy'],
  };
}

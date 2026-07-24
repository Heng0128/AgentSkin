// SPDX-License-Identifier: MPL-2.0

import { BaseApplicationAdapter, type InstallHints } from '../base';

/**
 * WorkBuddy — active adapter backed by @agentskin/core's "workbuddy" adapter.
 */
export class WorkbuddyAdapter extends BaseApplicationAdapter {
  readonly id = 'workbuddy';
  readonly name = 'WorkBuddy';
  readonly type = 'agent' as const;
  readonly tier = 'active' as const;
  readonly coreId = 'workbuddy';

  /** AgentSkin-side install detection hints (Windows). */
  readonly installHints: InstallHints = {
    dirNames: ['WorkBuddy'],
    exeNames: ['WorkBuddy.exe'],
    registryNames: ['WorkBuddy'],
  };
}

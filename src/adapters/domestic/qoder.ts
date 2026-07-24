// SPDX-License-Identifier: MPL-2.0

import { BaseApplicationAdapter, type InstallHints } from '../base';

/**
 * QoderWork CN — active adapter backed by @agentskin/core's "qoderwork" adapter.
 * Hosts an ephemeral debug port; the runtime + service handle port resolution.
 */
export class QoderAdapter extends BaseApplicationAdapter {
  readonly id = 'qoderwork';
  readonly name = 'QoderWork CN';
  readonly type = 'ide' as const;
  readonly tier = 'active' as const;
  readonly coreId = 'qoderwork';

  /**
   * AgentSkin-side install detection hints. @agentskin/core's discovery keys
   * off the running app; these let AgentSkin confirm a local install even
   * when QoderWork CN is closed (Program Files / AppData / Uninstall registry).
   */
  readonly installHints: InstallHints = {
    dirNames: ['QoderWork CN', 'QoderWork CN\\QoderWork CN'],
    exeNames: ['QoderWork CN.exe'],
    registryNames: ['QoderWork CN', 'QoderWork'],
  };
}

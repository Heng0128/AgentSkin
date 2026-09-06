// SPDX-License-Identifier: MPL-2.0

import { AGENT_META } from '../../shared/types';
import { WindowRole } from '../../shared/types/window-matcher';
import { BaseApplicationAdapter, type InstallHints } from '../base';

/**
 * QoderWork CN — active adapter backed by @agentskin/engine's "qoderwork" adapter.
 * Hosts an ephemeral debug port; the runtime + service handle port resolution.
 */
export class QoderAdapter extends BaseApplicationAdapter {
  readonly id = 'qoderwork';
  readonly name = AGENT_META.qoderwork.displayName;
  readonly type = 'ide' as const;
  readonly tier = 'active' as const;
  readonly coreId = 'qoderwork';

  /**
   * AgentSkin-side install detection hints. @agentskin/engine's discovery keys
   * off the running app; these let AgentSkin confirm a local install even
   * when QoderWork CN is closed (Program Files / AppData / Uninstall registry).
   */
  override readonly installHints: InstallHints = {
    dirNames: ['QoderWork CN', 'QoderWork CN\\QoderWork CN'],
    exeNames: ['QoderWork CN.exe'],
    registryNames: ['QoderWork CN', 'QoderWork'],
  };

  /**
   * 多窗口声明（P0-2）。QoderWork CN 目前主要暴露单主窗口，
   * 声明 main 角色即可覆盖。
   */
  readonly windowHints = [
    {
      role: WindowRole.Main,
      patterns: ['qoder', 'qoderwork'],
      label: 'QoderWork main',
    },
  ] as const;
}

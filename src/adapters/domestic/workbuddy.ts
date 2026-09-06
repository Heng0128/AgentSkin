// SPDX-License-Identifier: MPL-2.0

import { AGENT_META } from '../../shared/types';
import { WindowRole } from '../../shared/types/window-matcher';
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

  /**
   * 多窗口声明（P0-2）。WorkBuddy 暴露 13+ CDP target（主 page + 多个 webview/
   * iframe 内嵌面板）。主窗口走完整引擎注入，webview 面板由 hardening pass
   * 的并发 CSS 管线覆盖（无需额外 matcher —— matchTarget 已处理）。
   * 此处仅声明 main 角色用于 watcher 快速识别主窗口。
   */
  readonly windowHints = [
    {
      role: WindowRole.Main,
      patterns: ['workbuddy', 'app.asar', 'wb-'],
      label: 'WorkBuddy main',
    },
    {
      role: WindowRole.Popup,
      patterns: ['*/popout*', 'popout', 'floating'],
      label: 'WorkBuddy popup',
    },
  ] as const;
}

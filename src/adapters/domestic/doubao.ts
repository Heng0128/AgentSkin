// SPDX-License-Identifier: MPL-2.0

import { AGENT_META } from '../../shared/types';
import { WindowRole } from '../../shared/types/window-matcher';
import { BaseApplicationAdapter, type InstallHints } from '../base';

/**
 * 豆包 (Doubao) — active adapter backed by the engine's "doubao" adapter
 * (`src/engine/src/adapters/doubao.mjs`). Doubao is a Chromium-based Electron
 * desktop assistant (Doubao.exe); CDP access has been verified via
 * scripts/doubao-cdp.ps1. Windows-specific runtime patches (registry-based
 * exe discovery, matchTarget wrapping) live in agentskin-core-runtime.ts.
 */
export class DoubaoAdapter extends BaseApplicationAdapter {
  readonly id = 'doubao';
  readonly name = AGENT_META.doubao.displayName;
  readonly type = 'desktop' as const;
  readonly tier = 'active' as const;
  readonly coreId = 'doubao';

  /** AgentSkin-side install detection hints (Windows). */
  override readonly installHints: InstallHints = {
    dirNames: ['Doubao'],
    exeNames: ['Doubao.exe'],
    registryNames: ['Doubao', '豆包'],
  };

  /**
   * 多窗口声明（P0-2）。豆包 Desktop 除主聊天窗口（chrome://doubao-chat/chat）
   * 外，还有后台 service / boot 页等辅助 target。主窗口走完整注入管线，
   * 后台页标记为 Secondary 以避免被误当作主 renderer 注入。
   */
  readonly windowHints = [
    {
      role: WindowRole.Main,
      patterns: ['doubao-chat/chat', 'doubao', '豆包'],
      label: 'Doubao main chat',
    },
    {
      role: WindowRole.Popup,
      patterns: ['*/mini*', '*/popout*', 'mini', 'popout'],
      label: 'Doubao mini window',
    },
    {
      role: WindowRole.Secondary,
      patterns: ['*/background*', '*/service-worker*', 'background', 'service-worker'],
      label: 'Doubao background',
    },
  ] as const;
}

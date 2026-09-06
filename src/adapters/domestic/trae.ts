// SPDX-License-Identifier: MPL-2.0

import { AGENT_META } from '../../shared/types';
import { WindowRole } from '../../shared/types/window-matcher';
import { BaseApplicationAdapter, type InstallHints } from '../base';

/**
 * TRAE SOLO CN — active adapter backed by @agentskin/engine's "traework" adapter.
 * Detect, apply, and restore all delegate to the runtime. Both the global
 * edition ("TRAE SOLO") and the CN edition ("TRAE SOLO CN") are supported by
 * the same core adapter (same Code-OSS commit, byte-identical solo-lite UI
 * stylesheet); the hints below cover both install layouts on Windows.
 */
export class TraeAdapter extends BaseApplicationAdapter {
  readonly id = 'traework';
  readonly name = AGENT_META.traework.displayName;
  readonly type = 'agent' as const;
  readonly tier = 'active' as const;
  readonly coreId = 'traework';

  /**
   * AgentSkin-side install detection hints (Windows). The product's real
   * directory/exe names are "TRAE SOLO" / "TRAE SOLO CN" (with spaces), as
   * shipped by the official Inno Setup installer; the previous hints
   * ("Trae", "Trae.exe") never matched any real install.
   */
  override readonly installHints: InstallHints = {
    dirNames: ['TRAE SOLO', 'TRAE SOLO CN'],
    exeNames: ['TRAE SOLO.exe', 'TRAE SOLO CN.exe'],
    registryNames: ['TRAE SOLO', 'TRAE SOLO CN'],
  };

  /**
   * 多窗口声明（P0-2）。TRAE Work 除主 solo-lite 窗口外，还可能弹出
   * 独立浮层窗口（popout chat）。两类窗口均走完整引擎注入管线。
   */
  readonly windowHints = [
    {
      role: WindowRole.Main,
      patterns: ['*/solo-lite.*', 'solo-lite', 'trae', 'traework'],
      label: 'TRAE Work main',
    },
    {
      role: WindowRole.Popup,
      patterns: ['*/popout*', 'popout', 'floating'],
      label: 'TRAE Work popup',
    },
  ] as const;
}

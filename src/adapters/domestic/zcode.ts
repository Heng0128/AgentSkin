// SPDX-License-Identifier: MPL-2.0

import { AGENT_META } from '../../shared/types';
import { BaseApplicationAdapter, type InstallHints } from '../base';

/**
 * ZCode — active adapter backed by the engine's "zcode" adapter
 * (`src/engine/src/adapters/zcode.mjs`). ZCode is a packaged Electron
 * desktop app (v3.6.5+, product "ZCode", @zcode/desktop) shipping a local
 * Vite/React renderer (`file://` + `#root`), so it is CDP-themable like
 * Codex/Doubao. User-data lives under `%APPDATA%\ZCode\` (with the Chromium
 * profile in `session\`).
 */
export class ZcodeAdapter extends BaseApplicationAdapter {
  readonly id = 'zcode';
  readonly name = AGENT_META.zcode.displayName;
  readonly type = 'agent' as const;
  readonly tier = 'active' as const;
  readonly coreId = 'zcode';

  /**
   * AgentSkin-side install detection hints. The Windows installer is
   * Squirrel-based (ZCode.exe + Uninstall ZCode.exe in C:\Program Files\ZCode),
   * so the exe-name/registry probes below let AgentSkin confirm a local
   * install even when the app is closed.
   */
  readonly installHints: InstallHints = {
    dirNames: ['ZCode'],
    exeNames: ['ZCode.exe'],
    registryNames: ['ZCode'],
  };
}

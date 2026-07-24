// SPDX-License-Identifier: MPL-2.0

import { BaseApplicationAdapter, type InstallHints } from '../base';

/**
 * TRAE SOLO CN — active adapter backed by @agentskin/core's "traework" adapter.
 * Detect, apply, and restore all delegate to the runtime. Both the global
 * edition ("TRAE SOLO") and the CN edition ("TRAE SOLO CN") are supported by
 * the same core adapter (same Code-OSS commit, byte-identical solo-lite UI
 * stylesheet); the hints below cover both install layouts on Windows.
 */
export class TraeAdapter extends BaseApplicationAdapter {
  readonly id = 'traework';
  readonly name = 'TRAE';
  readonly type = 'agent' as const;
  readonly tier = 'active' as const;
  readonly coreId = 'traework';

  /**
   * AgentSkin-side install detection hints (Windows). The product's real
   * directory/exe names are "TRAE SOLO" / "TRAE SOLO CN" (with spaces), as
   * shipped by the official Inno Setup installer; the previous hints
   * ("Trae", "Trae.exe") never matched any real install.
   */
  readonly installHints: InstallHints = {
    dirNames: ['TRAE SOLO', 'TRAE SOLO CN'],
    exeNames: ['TRAE SOLO.exe', 'TRAE SOLO CN.exe'],
    registryNames: ['TRAE SOLO', 'TRAE SOLO CN'],
  };
}

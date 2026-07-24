// SPDX-License-Identifier: MPL-2.0

import { BaseApplicationAdapter, type InstallHints } from '../base';

/**
 * 豆包 (Doubao) — active adapter backed by a runtime-registered core adapter.
 *
 * @agentskin/core 0.6.0 does not ship a Doubao adapter, so one is registered
 * at module load in agentskin-core-runtime.ts. Doubao is a Chromium-based
 * Electron desktop assistant (Doubao.exe); CDP access has been verified via
 * scripts/doubao-cdp.ps1.
 */
export class DoubaoAdapter extends BaseApplicationAdapter {
  readonly id = 'doubao';
  readonly name = '豆包';
  readonly type = 'desktop' as const;
  readonly tier = 'active' as const;
  readonly coreId = 'doubao';

  /** AgentSkin-side install detection hints (Windows). */
  readonly installHints: InstallHints = {
    dirNames: ['Doubao'],
    exeNames: ['Doubao.exe'],
    registryNames: ['Doubao', '豆包'],
  };
}

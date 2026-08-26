// SPDX-License-Identifier: MPL-2.0

import { AGENT_META } from '../../shared/types';
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
}

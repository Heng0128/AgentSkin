// SPDX-License-Identifier: MPL-2.0

import { AGENT_META } from '../../shared/types';
import { BaseApplicationAdapter, type InstallHints } from '../base';

/**
 * OpenAI Codex (ChatGPT desktop app) — active adapter backed by the engine's
 * "codex" adapter (`src/engine/src/adapters/codex.mjs`). CDP access verified
 * on macOS (com.openai.codex / ChatGPT.app v26.707.72221, build 5307).
 *
 * The Codex Electron app uses an `app://` renderer scheme (matched by the
 * engine's `matchTarget`), rooted at `main[class*='MainContentSurface']`
 * (CSS-Modules hashed class; verified against a live renderer — NOT the
 * legacy `main.main-surface`). Theme injection uses the standard
 * palette→tokens→cosmetic→adapter pipeline (the codex tokens.css layer is a
 * pass-through; --color-token-* is owned by the per-theme codex.css).
 */
export class CodexAdapter extends BaseApplicationAdapter {
  readonly id = 'codex';
  readonly name = AGENT_META.codex.displayName;
  readonly type = 'agent' as const;
  readonly tier = 'active' as const;
  readonly coreId = 'codex';

  /**
   * AgentSkin-side install detection hints. The macOS bundle is ChatGPT.app
   * (com.openai.codex); Windows ships via MSIX (OpenAI.Codex appx package).
   * The hints below let AgentSkin confirm a local install even when the app
   * is closed, complementing @agentskin/engine's discovery.
   */
  readonly installHints: InstallHints = {
    dirNames: ['ChatGPT'],
    exeNames: ['ChatGPT.exe'],
    registryNames: ['ChatGPT', 'OpenAI Codex'],
    msixPackageNames: ['OpenAI.Codex'],
  };
}

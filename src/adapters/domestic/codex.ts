// SPDX-License-Identifier: MPL-2.0

import type { CdpSession } from '../../main/cdp/cdp-client';
import { injectMarkdownStyles } from '../../main/cdp/markdown-injector';
import { AGENT_META } from '../../shared/types';
import type { MarkdownInjectResult, MarkdownStyles } from '../../shared/types/markdown';
import { WindowRole } from '../../shared/types/window-matcher';
import { BaseApplicationAdapter, type InstallHints } from '../base';

/**
 * OpenAI Codex (ChatGPT desktop app) — active adapter backed by the engine's
 * "codex" adapter (`src/engine/src/adapters/codex.mjs`). CDP access verified
 * on macOS (com.openai.codex / ChatGPT.app v26.707.72221, build 5307).
 *
 * The Codex Electron app uses an `app://` renderer scheme (matched by the
 * engine's `matchTarget`), rooted at
 * `main:is(.main-surface, [data-app-shell-main-surface], [class*='_MainContentSurface_'])`
 * (selector contract synced with upstream Codex-Dream-Skin selectors.json,
 * verified 26.715 → 26.818 on both platforms: keep legacy anchors, append
 * stable attributes / CSS-Module prefixes, never match a full hash). Theme
 * injection uses the standard palette→tokens→cosmetic→adapter pipeline (the
 * codex tokens.css layer is a pass-through; --color-token-* is owned by the
 * per-theme codex.css).
 *
 * ## Markdown style injection
 *
 * Codex supports runtime Markdown style customization via CDP. The
 * `markdownStyles` field holds the user's configuration; call
 * `applyMarkdownStyles()` after theme injection to apply them to the active
 * renderer. Styles are in-memory only — they do NOT modify app.asar and are
 * automatically cleared on app restart.
 */
export class CodexAdapter extends BaseApplicationAdapter {
  readonly id = 'codex';
  readonly name = AGENT_META.codex.displayName;
  readonly type = 'agent' as const;
  readonly tier = 'active' as const;
  readonly coreId = 'codex';

  /**
   * Runtime Markdown style configuration. When set, {@link applyMarkdownStyles}
   * injects these styles into the active Codex renderer via CDP.
   */
  markdownStyles?: MarkdownStyles;

  /**
   * AgentSkin-side install detection hints. The macOS bundle is ChatGPT.app
   * (com.openai.codex); Windows ships via MSIX (OpenAI.Codex appx package).
   * The hints below let AgentSkin confirm a local install even when the app
   * is closed, complementing @agentskin/engine's discovery.
   */
  override readonly installHints: InstallHints = {
    dirNames: ['ChatGPT'],
    exeNames: ['ChatGPT.exe'],
    registryNames: ['ChatGPT', 'OpenAI Codex'],
    msixPackageNames: ['OpenAI.Codex'],
  };

  /**
   * 多窗口声明（P0-2）。Codex (ChatGPT Desktop) 除主 `app://` 渲染器外，
   * 还有 settings 窗口和 avatar-overlay 浮层。主窗口走完整注入，avatar-overlay
   * 标记为 Secondary（不注入）。
   */
  readonly windowHints = [
    {
      role: WindowRole.Main,
      patterns: ['app://', 'chatgpt', 'codex', 'openai'],
      label: 'Codex main',
    },
    {
      role: WindowRole.Settings,
      patterns: ['*/settings*', '*/preferences*', 'settings', 'preferences'],
      label: 'Codex settings',
    },
    {
      role: WindowRole.Secondary,
      patterns: ['avatar-overlay', 'initialRoute=avatar-overlay'],
      label: 'Codex avatar-overlay',
    },
  ] as const;

  /**
   * Apply the configured Markdown styles to a CDP session.
   *
   * Injects a `<style data-agentskin-markdown="true">` element into the
   * renderer document. Safe to call multiple times — previous injection is
   * removed before re-inserting.
   *
   * @param session  Active CDP session to the Codex renderer.
   * @returns        Injection result (success, ruleCount, optional error).
   */
  async applyMarkdownStyles(session: CdpSession): Promise<MarkdownInjectResult> {
    return injectMarkdownStyles(session, this.markdownStyles ?? {});
  }
}

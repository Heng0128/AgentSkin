// SPDX-License-Identifier: MPL-2.0

/**
 * # injection/engine-strategy
 *
 * Multi-layer engine theme injection via CDP.
 *
 * Injects theme using the L0-L4 architecture:
 *   Layer 0: palette.css   — per-theme color identity (--agentskin-* + -raw RGB values)
 *   Layer 1: tokens.css    — per-agent native token overrides (theme-agnostic, uses var(--agentskin-*))
 *   Layer 2: cosmetic.css  — per-agent visual polish (theme-agnostic)
 *   Layer 3: theme.css     — per-agent theme CSS (theme-specific native tokens + visual styles)
 *   Layer 4: adapter.mjs   — unified engine + adapter wrapper: structural adaptation, token auto-discovery,
 *                           MutationObserver self-healing, shadow DOM deep-core, visual tokens (--ag-*)
 *
 * Each CSS layer is ordered by source order so later layers override earlier ones at equal
 * specificity. The adapter runs as evaluated JS and creates its own sheet + observers.
 *
 * ## Unified Engine (engines/unified/engine.mjs)
 *
 * The adapter.mjs parameter passed to this strategy is the concatenation of:
 *   - engines/unified/engine.mjs (single-file replacement for 7 former shared modules:
 *     style-injector, adapter-engine, token-discovery, self-heal, deep-core,
 *     visual-engine, verify-and-feedback) — provides __agentskin__ namespace API:
 *       window.__agentskin__.engine.createAdapter, .tokenDiscovery.createAgent,
 *       .AdaptiveMutationObserver, .selfHeal.createSelfHeal, .DeepCore, .sheetManager
 *     Plus backward-compat bare globals: window.__agentskin_unified_engine__,
 *     window.__agentskin_shared_engine__, window.__agentskin_sheet_manager__, etc.
 *   - adapter-config.mjs (optional per-agent configuration, function hooks preserved)
 *   - adapter.mjs (thin per-agent wrapper / legacy IIFE)
 *
 * The cleanup expressions (CLEAR_ADAPTERS_BODY, CLEAR_HOST_BODY) handle both legacy
 * adapter markers (__agentskin_*_adapter__) and unified-engine div/art-layer residue.
 *
 * Also handles persistence via `Page.addScriptToEvaluateOnNewDocument` so
 * the engine re-applies itself automatically on every navigation/reload.
 *
 * For the simpler single-stylesheet injection strategy, see
 * {@link ./cdp-strategy}.
 */

import { readFile, stat } from 'node:fs/promises';
import {
  DEFAULT_VERIFY_DELAY_MS,
  RENDERER_CONFIG_GLOBAL,
  SESSION_DISABLED_KEY,
} from '../../../shared/injection-constants';
import {
  buildAtomicClearExpression,
  buildAtomicInjectionExpression,
} from '../../../shared/injection-runtime';
import type { AgentId } from '../../../shared/types';
import { mainWarnFromCatch } from '../../logger';
import type { CdpSession } from '../cdp-client';
import { getDefaultLandmarks, runLandmarkPreflight } from '../preflight';
import { waitForTheme } from './shared';
import type { ThemeVerification } from './types';

// ---------------------------------------------------------------------------
// Helpers (defined before use to satisfy hoisting order in some bundlers)
// ---------------------------------------------------------------------------

/**
 * Maximum hero image size for atomic data URL injection.
 *
 * Aligned with the rest of the codebase (`MAX_IMPORT_IMAGE_BYTES`,
 * `MAX_DOWNLOAD_BYTES`, `MAX_THEME_PACKAGE_BYTES` all use 50 MB).  Modern
 * V8 handles 50 MB strings without stalling parses, and the CDP transfer
 * budget is well within latency targets for Electron's local pipe.
 * Themes with larger hero images fall back to CSS-only background.
 *
 * 2026-09-02 Phase 2: raised from 5 MB → 50 MB to match the rest of the
 * codebase and stop silently discarding 8–20 MB 4K/8K hero images.
 */
const MAX_ATOMIC_HERO_BYTES = 50 * 1024 * 1024;

/**
 * Hero paths already rejected for exceeding {@link MAX_ATOMIC_HERO_BYTES},
 * mapped to the file size observed at rejection time.
 *
 * An oversized hero is a property of the theme package, not of the injection
 * attempt, but injection runs repeatedly (per agent, per retry, per
 * reload-watchdog pass). Without this cache every pass re-reads the whole
 * file only to throw it away — a 6MB hero re-read ~20 times in two minutes,
 * which is pure main-process I/O and a direct contributor to IPC timeouts.
 * The size is part of the key so replacing the file re-evaluates it.
 */
const oversizedHeroCache = new Map<string, number>();

/**
 * Report an oversized hero at most once per (path, size) combination.
 *
 * The warning describes a property of the theme package, so repeating it on
 * every retry adds no information — it only buries the real errors and slows
 * the main process down with log formatting.
 */
function warnOversizedHero(heroPath: string, size: number): void {
  if (oversizedHeroCache.get(heroPath) === size) return;
  oversizedHeroCache.set(heroPath, size);
  mainWarnFromCatch(
    'cdp/engine',
    new Error(
      `hero image ${Math.ceil(size / 1024 / 1024)}MB exceeds atomic limit ${MAX_ATOMIC_HERO_BYTES / 1024 / 1024}MB — falling back to CSS-only background`,
    ),
    `resolveHeroDataUrl: oversized hero ${heroPath}`,
  );
}

/**
 * Resolve the best available hero data URL from the injection options.
 *
 * Resolution order: explicit `heroDataUrl` (data:)  wins, then `heroPath` (file
 * read on main process).  Synchronous file I/O on the main process is fast and
 * does not block the UI thread; for a 4MB hero image this costs < 10ms on NVMe.
 *
 * Returns `null` for files larger than MAX_ATOMIC_HERO_BYTES — callers are
 * expected to fall back to CSS-only background for these themes.
 */
async function resolveHeroDataUrl(
  heroDataUrl: string | null | undefined,
  heroPath: string | null | undefined,
): Promise<string | null> {
  if (heroDataUrl && heroDataUrl.startsWith('data:')) {
    return heroDataUrl;
  }
  if (heroPath) {
    try {
      // Check the size with `stat` BEFORE reading. An oversized hero must not
      // be pulled into memory only to be discarded — that is the whole point
      // of the limit, and injection repeats this call many times per session.
      const { size } = await stat(heroPath);
      if (size > MAX_ATOMIC_HERO_BYTES) {
        warnOversizedHero(heroPath, size);
        return null;
      }

      const buf = await readFile(heroPath);
      // Re-check after read: the file may have been swapped between the two
      // calls. Same helper, so this cannot spam either.
      if (buf.length === 0) return null;
      if (buf.length > MAX_ATOMIC_HERO_BYTES) {
        warnOversizedHero(heroPath, buf.length);
        return null;
      }
      const ext = heroPath.split('.').pop()?.toLowerCase() ?? 'png';
      const mime =
        ext === 'png'
          ? 'image/png'
          : ext === 'jpg' || ext === 'jpeg'
            ? 'image/jpeg'
            : ext === 'webp'
              ? 'image/webp'
              : ext === 'gif'
                ? 'image/gif'
                : 'image/png';
      return `data:${mime};base64,${buf.toString('base64')}`;
    } catch (err) {
      mainWarnFromCatch('cdp/engine', err, `read hero file failed: ${heroPath}`);
      return null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InjectEngineOptions {
  /** Per-theme palette CSS (~1KB, defines --agentskin-* tokens including -raw RGB values). */
  paletteCss: string;
  /** Per-agent engine tokens.css (pure token overrides). */
  tokensCss: string;
  /** Per-agent engine cosmetic.css (visual polish, allowed to degrade). */
  cosmeticCss: string;
  /**
   * Per-agent adapter JS — concatenation of engines/unified/engine.mjs (replaces 7 former
   * shared modules) + optional adapter-config.mjs + adapter.mjs. The unified engine provides
   * createAdapter, tokenDiscovery, AdaptiveMutationObserver, selfHeal, DeepCore, and sheetManager
   * under both the window.__agentskin__ namespace and bare-legacy globals.
   */
  adapterJs: string;
  /**
   * Per-agent theme CSS (the full resolved target CSS, e.g. doubao.css).
   * Injected as a 4th "theme" layer AFTER cosmetic to provide native token
   * overrides (--dbx-*, --vscode-*) and visual styles that the engine
   * layers don't cover. Optional — omitted when no per-agent CSS exists.
   */
  themeCss?: string;
  /**
   * Global user-authored custom CSS (custom.css). Injected as the 5th and
   * LAST CSS layer so it beats every theme layer at equal specificity —
   * the "user override wins" guarantee. Optional — omitted when unset.
   */
  customCss?: string;
  /**
   * Hero image as data URL (data:image/webp;base64,...). Preferred form —
   * the atomic expression inlines it + synchronous Blob conversion, so the
   * --agentskin-art variable and the CSS rule appear in the same frame.
   */
  heroDataUrl?: string | null;
  /**
   * Absolute path to hero image file (alternative to heroDataUrl).  The file
   * is read synchronously on the main process via `resolveHeroDataUrl` and
   * converted to a data URL before the atomic evaluate.  Always prefer
   * `heroDataUrl` when the data is already in memory.
   */
  heroPath?: string | null;
  /** Agent identifier for logging (e.g. "doubao"). */
  agent?: string;
  /** Theme identifier for logging (e.g. "midnight-aurora"). */
  themeId?: string;
  /** Delay between injection and verification in ms (default DEFAULT_VERIFY_DELAY_MS). */
  verifyDelayMs?: number;
  /** Poll interval for the verification loop (default 50ms, RFC §4.8). */
  verifyIntervalMs?: number;
  /** Verification timeout in ms (default 3000). Shorter values speed up tests. */
  verifyTimeoutMs?: number;
}

export interface InjectEngineResult {
  /** Number of CSS layers injected (palette + tokens + cosmetic + theme + custom). */
  layersInjected: number;
  /** Whether the adapter JS executed successfully. */
  adapterApplied: boolean;
  /** Whether the hero image was resolved and injected. */
  heroInjected: boolean;
  /** Verification read-back values. */
  verification: ThemeVerification | null;
  /** Whether all critical checks passed. */
  success: boolean;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Inject theme using the multi-layer engine architecture:
 *   Layer 0: palette.css   — per-theme color identity (--agentskin-* + -raw RGB values)
 *   Layer 1: tokens.css    — per-agent native token overrides (theme-agnostic, uses var(--agentskin-*))
 *   Layer 2: cosmetic.css  — per-agent visual polish (theme-agnostic)
 *   Layer 3: theme.css     — per-agent theme CSS (theme-specific native tokens + visual styles)
 *   Layer 4: adapter.mjs   — unified engine (engines/unified/engine.mjs) + optional
 *                           adapter-config.mjs + adapter.mjs wrapper
 *
 * The adapter.mjs param is the concatenation produced by the orchestrator:
 *   1. engines/unified/engine.mjs — single file replacing 7 former shared modules
 *      (style-injector, adapter-engine, token-discovery, self-heal, deep-core,
 *      visual-engine, verify-and-feedback). Exposes window.__agentskin__.engine.createAdapter,
 *      .tokenDiscovery, .AdaptiveMutationObserver, .selfHeal, .DeepCore, .sheetManager
 *      plus backward-compat bare globals (__agentskin_unified_engine__, __agentskin_shared_engine__, etc.).
 *   2. adapter-config.mjs (optional) — per-agent config with function hooks.
 *   3. adapter.mjs — thin per-agent wrapper.
 *
 * The theme layer (3) is injected AFTER the engine layers so theme-specific
 * native token overrides (--dbx, --vscode, etc.) take precedence over the
 * engine's theme-agnostic var() mappings. CSS is concatenated into a single
 * <style> element per the DreamSkin-aligned approach; the adapter runs as evaluated
 * JS and creates its own sheet + observers.
 */
export async function injectThemeViaEngine(
  session: CdpSession,
  options: InjectEngineOptions,
): Promise<InjectEngineResult> {
  const {
    paletteCss,
    tokensCss,
    cosmeticCss,
    themeCss,
    customCss,
    adapterJs,
    heroDataUrl,
    heroPath,
    agent,
    themeId,
    verifyDelayMs = DEFAULT_VERIFY_DELAY_MS,
    verifyIntervalMs = 50,
    verifyTimeoutMs = 3000,
  } = options;

  try {
    await session.send('Runtime.enable');
  } catch (err) {
    mainWarnFromCatch(
      'cdp/engine',
      err,
      `Runtime.enable failed for agent=${agent ?? 'unknown'} theme=${themeId ?? 'unknown'}`,
    );
    return {
      layersInjected: 0,
      adapterApplied: false,
      heroInjected: false,
      verification: null,
      success: false,
    };
  }

  // --- Step 0: Landmark preflight (inject-before-verify) ---
  // Verify the target page has required DOM anchors before attempting
  // injection. Inspired by CodeDrobe/core's preflight mechanism.
  // Best-effort: if preflight fails, log warning but continue (fail-open
  // for backward compatibility — can be made strict later).
  if (agent) {
    try {
      const landmarks = getDefaultLandmarks(agent as AgentId);
      if (landmarks.length > 0) {
        const preflight = await runLandmarkPreflight(session, landmarks);
        if (!preflight.passed) {
          mainWarnFromCatch(
            'cdp/engine',
            new Error(
              `landmark preflight failed: misses=${JSON.stringify(preflight.misses.map((m) => m.name))}`,
            ),
            `preflight blocked agent=${agent} theme=${themeId ?? 'unknown'}`,
          );
        }
      }
    } catch {
      // Best-effort — preflight must not block injection.
    }
  }

  // --- Step 1: Atomic clear — 单次 evaluate 清理所有残留 ---
  // 2026-09-01 原子化重构：不再逐步清理，使用 buildAtomicClearExpression 一次性
  // 删除 style 元素、adapter markers、host class、legacy globals、旧 blob URL。
  try {
    await session.evaluate(buildAtomicClearExpression());
  } catch (err) {
    mainWarnFromCatch('cdp/engine', err, `atomic clear failed for agent=${agent ?? 'unknown'}`);
  }

  // --- Step 1b: Clear sessionStorage disable flag ---
  try {
    await session.evaluate(`(() => {
      try { sessionStorage.removeItem(${JSON.stringify(SESSION_DISABLED_KEY)}); } catch (e) {}
      return 'ok';
    })()`);
  } catch {
    // Best-effort.
  }

  // --- Step 2: Build complete CSS (all L0-L4 layers into single string) ---
  const cssParts = [paletteCss, tokensCss, cosmeticCss];
  if (themeCss) cssParts.push(themeCss);
  if (customCss) cssParts.push(customCss);
  const allCss = cssParts.join('\n');

  // --- Step 3: 主进程同步读取 Hero 图片 → data URL ---
  // 2026-09-01: 学习 DreamWork/Codex-Dream-Skin。主进程读取图片文件转为 base64
  // data URL, 内联到注入脚本中。渲染端 IIFE 同步转换为 Blob URL + 设置 CSS 变量,
  // 单次 evaluate 内 CSS 与背景图原子出现, 彻底消除闪烁。
  const resolvedHeroDataUrl = await resolveHeroDataUrl(heroDataUrl, heroPath);
  const heroInjected = !!resolvedHeroDataUrl;

  // --- Step 4: Atomic injection — 单次 evaluate 完成 CSS + Hero + 变量 ---
  let layersInjected = 0;
  try {
    const expr = buildAtomicInjectionExpression({
      css: allCss,
      heroDataUrl: resolvedHeroDataUrl,
      agentId: agent ?? '',
    });
    const result = await session.evaluate(expr);
    if (typeof result === 'string' && result.startsWith('ok:')) {
      layersInjected = cssParts.length;
    } else {
      throw new Error(`atomic injection returned: ${result}`);
    }
  } catch (err) {
    return {
      layersInjected: 0,
      adapterApplied: false,
      heroInjected,
      verification: null,
      success: false,
    };
  }

  // --- Step 4b: Set adapter config ---
  try {
    const configJson = JSON.stringify({ agent: agent ?? '', themeId: themeId ?? '' });
    await session.evaluate(`(() => {
      try { window.${RENDERER_CONFIG_GLOBAL} = ${configJson}; return 'ok'; }
      catch (e) { return 'err:' + e.message; }
    })()`);
  } catch (err) {
    mainWarnFromCatch('cdp/engine', err, `set config failed for agent=${agent ?? 'unknown'}`);
  }

  // --- Step 5: Run adapter JS (executed as evaluate) ---
  let adapterApplied = false;
  try {
    const adapterResult = await session.evaluate(adapterJs);
    adapterApplied = adapterResult === 'applied' || adapterResult === 'already-applied';
  } catch (err) {
    adapterApplied = false;
    mainWarnFromCatch(
      'cdp/engine',
      err,
      `adapter evaluate failed for agent=${agent ?? 'unknown'} theme=${themeId ?? 'unknown'}`,
    );
  }

  // --- Step 5b (removed, RFC 2026-08-18 P2) ---
  // This engine used to register its own new-document persistence via
  // `registerEnginePersistence` (a `Page.addScriptToEvaluateOnNewDocument`).
  // P2 retired it: the registration ran on the operation-scoped pooled session,
  // and since `Page.addScriptToEvaluateOnNewDocument` registrations are
  // **session-bound** (verified 2026-08-17), closing that session at the epoch
  // boundary dropped the script before the next navigation — it never survived
  // reload. The core runtime (@agentskin/engine `injector.mjs`) owns the single
  // authoritative persistence on a dedicated long-lived `persistenceSessions`;
  // this engine only injects the current document. `removeEngineInjection`
  // below still sets the shared `SESSION_DISABLED_KEY` as belt-and-suspenders.

  // --- Step 6: Verify (polling with timeout) ---
  const { verification, applied } = await waitForTheme(session, {
    timeoutMs: verifyTimeoutMs,
    intervalMs: verifyIntervalMs,
    minDelayMs: verifyDelayMs,
    agentId: agent,
  });

  // RC4-A: waitForTheme returns a rich WaitForThemeResult. `applied` is the
  // backward-compatible boolean (verdict === 'full'), equivalent to the old
  // isThemeFullyApplied(verification, { requireHero }) check.
  const success = layersInjected >= 2 && adapterApplied && applied;

  return {
    layersInjected,
    adapterApplied,
    heroInjected,
    verification,
    success: layersInjected >= 2 && adapterApplied && applied,
  };
}

/**
 * Tear down the engine layers + adapter from the current document.
 * Called during theme restore so the engine doesn't re-apply itself on the
 * next navigation.
 *
 * This mirrors `injectThemeViaEngine`'s apply path: every DOM-bearing target
 * that received engine injection must be cleaned up here, otherwise stale
 * adoptedStyleSheets and adapter markers survive restore.
 *
 * RFC 2026-08-18 P2: this engine no longer registers its own new-document
 * persistence (that is core-owned on dedicated long-lived sessions), so there
 * are no tracked script identifiers to remove. It still sets the shared
 * `SESSION_DISABLED_KEY` as belt-and-suspenders so any core persistence script
 * that could not be explicitly removed skips on future navigations.
 *
 * Best-effort: never throws — callers use it in fire-and-forget restore paths.
 */
export async function removeEngineInjection(session: CdpSession): Promise<void> {
  // 1. Set the disable flag in sessionStorage as a belt-and-suspenders
  //    fallback, mirroring core's removeTheme. This persists across
  //    navigations within the same tab/session, so any persistence script we
  //    couldn't remove (e.g. registered by a previous process incarnation
  //    whose identifiers were never tracked) still skips re-application on
  //    future navigations.
  try {
    await session.send('Runtime.enable');
    await session.evaluate(`(() => {
      try { sessionStorage.setItem('${SESSION_DISABLED_KEY}', '1'); } catch (e) { console.warn('[engine-strategy] sessionStorage.setItem failed:', e); }
      return 'ok';
    })()`);
  } catch {
    // Best-effort — target may not have sessionStorage yet.
  }

  // 2. Tear down the engine layers + adapter from the current document.
  try {
    await session.evaluate(buildAtomicClearExpression());
  } catch {
    // Best-effort — target may have navigated away.
  }
}

// ---------------------------------------------------------------------------
// Lifecycle cleanup (module-scoped maps)

// SPDX-License-Identifier: MPL-2.0

/**
 * # CDP Fan-out
 *
 * Extracted from `AgentEngineService` (P1-5 of the god-object teardown).
 *
 * Owns the multi-target CDP fan-out that sits between
 * `adapter.applyTheme` / `adapter.restoreTheme` and the extracted
 * single-target modules. The fan-out iterates ALL DOM-bearing CDP
 * targets (page, webview, iframe) on a port so the engine layers and
 * CSS are applied to every user-visible surface — critical for apps
 * like WorkBuddy that have 13+ CDP targets where previously only the
 * first page was themed.
 *
 * Four functions, two pairs:
 *   - {@link injectSecondaryTargets} / {@link removeSecondaryTargets} —
 *     CSS-only injection into webviews/iframes that the core's
 *     matchTarget/preflight filter out.
 *   - {@link hardeningPass} / {@link hardeningRemove} — engine
 *     multi-layer injection (palette + tokens + cosmetic + theme +
 *     adapter.mjs) into ALL DOM-bearing targets, plus a DOM health
 *     check on the first page session.
 *
 * Why these go together: all four share the same target-discovery
 * pattern (`findDomTargets` / `findSecondaryTargets`), the same
 * per-target CDP session lifecycle, and the same epoch-cancellation
 * guard (they abort mid-loop if a newer apply/restore supersedes the
 * in-flight one). None of them own state — they're pure orchestration
 * over a deps slice injected by the facade.
 *
 * Call chain:
 *   AgentEngineService.apply   → injectSecondaryTargets + hardeningPass
 *   AgentEngineService.restore → hardeningRemove + removeSecondaryTargets
 */

import type { ApplicationAdapter } from '../../adapters/base';
import {
  type ResolvedThemeTarget,
  resolveThemeTargetFor,
  type ThemeBundle,
} from '../../legacy/agentskin-core-runtime';
import { toMessage } from '../../shared/errors';
import {
  DEFAULT_VERIFY_DELAY_MS,
  hostClassFor,
  WALLPAPER_PUNCH_GLOBAL,
} from '../../shared/injection-constants';
import type { AgentId } from '../../shared/types';
import { checkThemeHealth } from '../theme-health-check';
import { type CdpSession, connectCdp } from './cdp-client';
import { type InjectEngineResult, injectThemeViaCdp, removeEngineInjection } from './cdp-inject';
import { findDomTargets, findSecondaryTargets } from './cdp-targets';
import { buildSecondaryInjectExpression, buildSecondaryRemoveExpression } from './secondary-inject';

// ---------------------------------------------------------------------------
// Deps slice
// ---------------------------------------------------------------------------

/**
 * Dependencies injected by {@link AgentEngineService} so this module stays
 * stateless. Mirrors the `*Deps` pattern of the other extracted modules
 * (app-discovery / palette-builder / scheme-sync / wallpaper-injector).
 *
 * `tryEngineInjection` is passed as a callback (rather than imported
 * directly) so this module doesn't need to know about engine-dir
 * resolution — the facade owns that concern via `palette-builder`.
 */
export interface CdpFanoutDeps {
  /** Resolve the adapter for an app (from the registry). */
  adapter: (appId: AgentId) => ApplicationAdapter;
  /** Epoch guard — true if `captured` is still the current epoch for `appId`. */
  isEpochCurrent: (appId: AgentId, captured: number) => boolean;
  /**
   * Attempt engine-based multi-layer injection on a single session.
   * Returns null when engine files are missing (triggers legacy fallback
   * in {@link hardeningPass}). Delegated to `palette-builder` by the
   * facade so this module stays free of filesystem concerns.
   */
  tryEngineInjection: (
    session: CdpSession,
    appId: AgentId,
    bundle: ThemeBundle,
    targetTheme: ResolvedThemeTarget,
    heroDataUrl: string | null,
  ) => Promise<InjectEngineResult | null>;
  /** Logger sink (usually `AgentEngineService.log`). */
  log: (line: string) => void;
}

// ---------------------------------------------------------------------------
// Connect retry (B4 — CDP-2)
// ---------------------------------------------------------------------------

/**
 * Connect to a target's CDP endpoint with bounded retry. Only transport-level
 * connect failures are retried (socket refused, timeout) — a session that
 * opened but failed later is handled by the caller. The app may still be
 * booting (target list fresh, port just opened), so a brief backoff often
 * salvages the first connect.
 *
 * @param url      target.webSocketDebuggerUrl
 * @param openMs   socket open timeout per attempt
 * @param attempts total attempts (default 3 = 1 initial + 2 retries)
 * @param delays   backoff between attempts (ms), index-aligned with attempt #
 */
export async function connectWithRetry(
  url: string,
  openMs = 4000,
  attempts = 3,
  delays: number[] = [500, 1500],
): Promise<CdpSession | null> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await connectCdp(url, openMs);
    } catch {
      if (attempt >= attempts - 1) return null;
      const wait = delays[attempt] ?? 500;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Secondary targets (webviews / iframes) — CSS-only
// ---------------------------------------------------------------------------

/**
 * Inject the theme CSS into ALL secondary CDP targets (webviews, iframes)
 * that the core's matchTarget/preflight filter out.
 *
 * WorkBuddy embeds MCP apps in <webview> tags and ardot.tencent.com content
 * in <iframe>s — these are visible UI surfaces that would otherwise show
 * unthemed content, breaking visual consistency with the main window which
 * core's applyTheme already themed.
 *
 * This is CSS-only: the core's renderer profile (chrome-layer overlay) is
 * deliberately skipped because it targets the main page's DOM structure
 * (.teams-main-content, .wb-home-page) which doesn't exist in embedded
 * content. The CSS variables + stylesheet alone are enough for the embedded
 * React apps to inherit the theme's colors.
 *
 * Best-effort: failures on individual secondary targets are logged but
 * never fail the overall apply. Aborts mid-loop if the epoch flips.
 */
export async function injectSecondaryTargets(
  appId: AgentId,
  port: number,
  bundle: ThemeBundle,
  epoch: number,
  deps: CdpFanoutDeps,
): Promise<void> {
  if (!deps.isEpochCurrent(appId, epoch)) return;
  const adapter = deps.adapter(appId);
  let targetTheme: ResolvedThemeTarget;
  try {
    targetTheme = resolveThemeTargetFor(bundle, adapter.coreId);
  } catch (error) {
    deps.log(`[secondary] ${appId}: resolveThemeTarget failed: ${toMessage(error)}`);
    return;
  }

  // Secondary targets = DOM-bearing types other than the main page.
  // The main page (type: "page") is already handled by adapter.applyTheme.
  // Workers have no DOM and are correctly excluded.
  const secondary = await findSecondaryTargets(port);
  if (!secondary.length) {
    deps.log(`[secondary] ${appId}: no secondary targets (webview/iframe) on port ${port}`);
    return;
  }

  const expression = buildSecondaryInjectExpression(appId, targetTheme);
  let injected = 0;
  let failed = 0;
  for (const target of secondary) {
    // Abort if a newer apply/restore superseded this one mid-loop.
    if (!deps.isEpochCurrent(appId, epoch)) {
      deps.log(
        `[secondary] ${appId}: epoch changed, aborting after ${injected}/${secondary.length}`,
      );
      return;
    }
    try {
      const session = await connectWithRetry(target.webSocketDebuggerUrl!, 3000);
      if (!session) {
        failed++;
        deps.log(
          `[secondary] ${appId}: target ${target.type} "${target.title?.slice(0, 40)}" connect failed after retries`,
        );
        continue;
      }
      try {
        const result = await session.evaluate(expression);
        if (result.includes('"installed":true')) {
          injected++;
        } else {
          failed++;
          deps.log(
            `[secondary] ${appId}: target ${target.type} "${target.title?.slice(0, 40)}" returned: ${result}`,
          );
        }
      } finally {
        session.close();
      }
    } catch (error) {
      failed++;
      deps.log(
        `[secondary] ${appId}: target ${target.type} "${target.title?.slice(0, 40)}" evaluate failed: ${toMessage(error)}`,
      );
    }
  }
  deps.log(
    `[secondary] ${appId}: injected CSS into ${injected}/${secondary.length} secondary target(s)` +
      (failed ? ` (${failed} failed)` : '') +
      ` — webviews/iframes on port ${port}`,
  );
}

/**
 * Remove the theme CSS from all secondary CDP targets (webviews, iframes).
 * Called during restore so embedded content doesn't keep showing a stale
 * theme after the main window is restored. Best-effort. Aborts mid-loop
 * if the epoch flips.
 */
export async function removeSecondaryTargets(
  appId: AgentId,
  port: number,
  epoch: number,
  deps: CdpFanoutDeps,
): Promise<void> {
  if (!deps.isEpochCurrent(appId, epoch)) return;
  const secondary = await findSecondaryTargets(port);
  if (!secondary.length) return;

  const expression = buildSecondaryRemoveExpression(appId);
  let removed = 0;
  for (const target of secondary) {
    if (!deps.isEpochCurrent(appId, epoch)) {
      deps.log(
        `[secondary] ${appId}: epoch changed, aborting remove after ${removed}/${secondary.length}`,
      );
      return;
    }
    try {
      const session = await connectCdp(target.webSocketDebuggerUrl!, 3000);
      try {
        await session.evaluate(expression);
        removed++;
      } finally {
        session.close();
      }
    } catch {
      // Best-effort — embedded content may have navigated away.
    }
  }
  deps.log(
    `[secondary] ${appId}: removed CSS from ${removed}/${secondary.length} secondary target(s)`,
  );
}

// ---------------------------------------------------------------------------
// Hardening pass — engine multi-layer injection into ALL DOM targets
// ---------------------------------------------------------------------------

/**
 * Hardening pass: re-inject the theme via adoptedStyleSheets (stealth
 * channel that bypasses MutationObserver anti-tamper) and verify the
 * theme actually took effect. Runs AFTER core's applyTheme succeeds as
 * a safety net — particularly important for Doubao which strips <style>
 * elements within ~50ms of insertion.
 *
 * Iterates ALL DOM-bearing CDP targets (page, webview, iframe) so the
 * engine layers (palette/tokens/cosmetic/theme CSS + adapter.mjs) are
 * applied to every user-visible surface. This is critical for apps like
 * WorkBuddy that have 13+ CDP targets — previously only the first page
 * was themed, leaving webviews and iframes unstyled. The adapter.mjs
 * and CSS layers are also registered via Page.addScriptToEvaluateOnNewDocument
 * inside `injectThemeViaEngine` so they survive navigation/reload.
 *
 * Also runs a DOM health check on the main page to detect opaque layers
 * that block the hero art, logging a score for diagnostics.
 *
 * Aborts mid-loop if the epoch flips (newer apply/restore superseded).
 */
export async function hardeningPass(
  appId: AgentId,
  port: number,
  bundle: ThemeBundle,
  epoch: number,
  deps: CdpFanoutDeps,
): Promise<void> {
  if (!deps.isEpochCurrent(appId, epoch)) return;
  const adapter = deps.adapter(appId);
  let targetTheme: ResolvedThemeTarget;
  try {
    targetTheme = resolveThemeTargetFor(bundle, adapter.coreId);
  } catch (error) {
    deps.log(`[hardening] ${appId}: resolveThemeTarget failed: ${toMessage(error)}`);
    return;
  }

  // List ALL DOM-bearing targets on the port. The previous implementation
  // only processed the first `type: "page"` target, which left webviews,
  // iframes, and additional page targets (e.g. WorkBuddy's 13 targets)
  // without engine theming. DOM-bearing = page, webview, iframe (workers
  // have no DOM and are correctly excluded).
  const domTargets = await findDomTargets(port);
  if (!domTargets.length) {
    deps.log(`[hardening] ${appId}: no DOM-bearing targets on port ${port}`);
    return;
  }

  const heroDataUrl = targetTheme.imageDataUrls?.hero ?? targetTheme.artDataUrl ?? null;
  let engineInjected = 0;
  let legacyInjected = 0;
  let failed = 0;
  let firstSession: CdpSession | null = null;

  for (const target of domTargets) {
    // Abort if a newer apply/restore superseded this one mid-loop.
    if (!deps.isEpochCurrent(appId, epoch)) {
      deps.log(
        `[hardening] ${appId}: epoch changed, aborting after ${engineInjected + legacyInjected}/${domTargets.length}`,
      );
      if (firstSession) firstSession.close();
      return;
    }

    let session: CdpSession | null = null;
    try {
      session = await connectWithRetry(target.webSocketDebuggerUrl!, 4000);
    } catch {
      session = null;
    }
    if (!session) {
      failed++;
      deps.log(
        `[hardening] ${appId}: ${target.type} "${target.title?.slice(0, 40)}" connect failed after retries`,
      );
      continue;
    }

    try {
      // Try engine architecture first (palette + tokens + cosmetic + theme + adapter.mjs).
      // This also registers persistence via Page.addScriptToEvaluateOnNewDocument
      // so the engine re-applies itself on every navigation/reload.
      const engineResult = await deps.tryEngineInjection(
        session,
        appId,
        bundle,
        targetTheme,
        heroDataUrl,
      );

      if (engineResult) {
        engineInjected++;
        if (!firstSession) {
          deps.log(
            `[hardening] ${appId}: ENGINE [page] layers=${engineResult.layersInjected} ` +
              `adapter=${engineResult.adapterApplied} hero=${engineResult.heroInjected} ` +
              `accent=${engineResult.verification?.accent || '?'}`,
          );
        }
      } else {
        // Fallback: legacy single-CSS injection (when engine files missing).
        // Only apply to page targets — webviews/iframes get basic CSS via
        // injectSecondaryTargets which runs separately.
        if (target.type === 'page') {
          const result = await injectThemeViaCdp(session, {
            css: targetTheme.css,
            heroDataUrl,
            hostClass: hostClassFor(appId),
            retries: 1,
            verifyDelayMs: DEFAULT_VERIFY_DELAY_MS,
          });
          legacyInjected++;
          if (!firstSession) {
            deps.log(
              `[hardening] ${appId}: LEGACY [page] css=${result.cssInjected} hero=${result.heroInjected} ` +
                `verified=${result.verification?.heroBlobActive ?? 'n/a'} ` +
                `accent=${result.verification?.accent || '?'}`,
            );
          }
        }
      }

      // Keep the first successful page session for the health check below.
      if (!firstSession && target.type === 'page') {
        firstSession = session;
      }
    } catch (error) {
      failed++;
      deps.log(`[hardening] ${appId}: ${target.type} injection failed: ${toMessage(error)}`);
    } finally {
      // Close unless we're keeping this session for the health check.
      if (session !== firstSession) {
        session.close();
      }
    }
  }

  deps.log(
    `[hardening] ${appId}: applied to ${engineInjected + legacyInjected}/${domTargets.length} targets ` +
      `(engine=${engineInjected} legacy=${legacyInjected}${failed ? ` failed=${failed}` : ''})`,
  );

  // Health check: detect opaque layers blocking the hero art. Run on the
  // first page session only — it's diagnostics, not per-target.
  if (firstSession) {
    try {
      const health = await checkThemeHealth(firstSession, appId);
      deps.log(
        `[hardening] ${appId}: health score=${health.score}/100 ` +
          `blocking=${health.blockingCount} layers ` +
          `art=${health.heroArtActive} sheet=${health.themeSheetPresent} ` +
          `hostClass=${health.hostClassPresent} adapter=${health.adapterPresent}`,
      );
      // Log native token values — if these are empty, the agent's variable
      // names have changed and the theme CSS overrides won't take effect.
      const tokenEntries = Object.entries(health.nativeTokens || {});
      if (tokenEntries.length > 0) {
        const tokenSummary = tokenEntries.map(([k, v]) => `${k}=${v || '<empty>'}`).join(' ');
        deps.log(`[hardening] ${appId}: native tokens: ${tokenSummary}`);
      }
      if (health.blockingCount > 0 && health.score < 50) {
        const top = health.opaqueLayers
          .filter((l) => l.visible)
          .slice(0, 5)
          .map((l) => `${l.tagName}.${l.classes.split(' ')[0]}(${l.size})`)
          .join(', ');
        deps.log(`[hardening] ${appId}: top blockers: ${top}`);
      }
      // Re-append the wallpaper punch-through sheet to the END of
      // adoptedStyleSheets. The hardening pass's injectCssAdopted appends a
      // new theme sheet after the punch-through, which lets the adapter's
      // body::before art-layer rule win on source order (equal specificity).
      // Moving the punch-through sheet back to the end restores its priority
      // so the wallpaper remains visible through the art layer.
      try {
        await firstSession.evaluate(`(() => {
          var sheet = window['${WALLPAPER_PUNCH_GLOBAL}_sheet'];
          if (!sheet) return 'no-wp';
          document.adoptedStyleSheets = Array.from(document.adoptedStyleSheets || []).filter(function(s){ return s !== sheet; }).concat([sheet]);
          return 'wp-reappended';
        })()`);
      } catch (error) {
        deps.log(
          `[hardening] ${appId}: failed to re-append wallpaper punch-through sheet — ` +
            `theme art-layer may hide the wallpaper: ${(error as Error)?.message ?? String(error)}`,
        );
      }
    } finally {
      firstSession.close();
    }
  }
}

/**
 * Remove engine injection (CSS layers + adapter.mjs + persistence script)
 * from ALL DOM-bearing CDP targets on the port. This is the counterpart
 * to {@link hardeningPass} and must iterate the same set of targets
 * (page, webview, iframe) so no surface retains a stale theme after
 * restore.
 *
 * Called during `restore` BEFORE `adapter.restoreTheme` so the core
 * runtime's cleanup runs against a target that has already been stripped
 * of the engine's adoptedStyleSheets and adapter markers.
 *
 * Aborts mid-loop if the epoch flips.
 */
export async function hardeningRemove(
  appId: AgentId,
  port: number,
  epoch: number,
  deps: CdpFanoutDeps,
): Promise<void> {
  if (!deps.isEpochCurrent(appId, epoch)) return;

  const domTargets = await findDomTargets(port);
  if (!domTargets.length) return;

  let removed = 0;
  for (const target of domTargets) {
    if (!deps.isEpochCurrent(appId, epoch)) {
      deps.log(
        `[hardening-remove] ${appId}: epoch changed, aborting after ${removed}/${domTargets.length}`,
      );
      return;
    }
    try {
      const session = await connectCdp(target.webSocketDebuggerUrl!, 3000);
      try {
        // Pass appId so removeEngineInjection can also remove the tracked
        // Page.addScriptToEvaluateOnNewDocument identifiers (P1 audit #8).
        await removeEngineInjection(session, appId);
        removed++;
      } finally {
        session.close();
      }
    } catch {
      // Best-effort — target may have navigated away or closed.
    }
  }
  deps.log(
    `[hardening-remove] ${appId}: removed engine from ${removed}/${domTargets.length} target(s)`,
  );
}

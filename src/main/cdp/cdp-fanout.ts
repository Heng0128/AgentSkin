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
 * Two functions, one pair:
 *   - {@link hardeningPass} / {@link hardeningRemove} — iterate ALL
 *     DOM-bearing targets (page, webview, iframe). `page` targets get the
 *     engine multi-layer injection (palette + tokens + cosmetic + theme +
 *     adapter.mjs) plus a DOM health check; non-page targets (webviews/
 *     iframes) that the core's matchTarget/preflight filter out get a
 *     lightweight CSS-only injection inline — they share the loop and the
 *     resolved target theme so no surface is written twice.
 *
 * The two target classes were previously handled by separate functions
 * (`injectSecondaryTargets` CSS-only + `hardeningPass` engine), which
 * double-wrote webviews/iframes when engine files existed. They're now
 * unified here: a webview/iframe is either engine-injected (nothing, it's
 * non-page) or lightweight-injected exactly once by this loop, and the
 * per-target progress events (formerly `injectSecondaryTargets`) are emitted
 * from the same pass for the renderer timeline.
 *
 * Why these go together: all of them share the same target-discovery
 * pattern (`findDomTargets`), the same per-target CDP session lifecycle,
 * and the same epoch-cancellation guard (they abort mid-loop if a newer
 * apply/restore supersedes the in-flight one). They own no state — pure
 * orchestration over a deps slice injected by the facade.
 *
 * Call chain:
 *   AgentEngineService.apply   → hardeningPass (page engine + non-page CSS)
 *   AgentEngineService.restore → hardeningRemove (page engine + non-page CSS)
 */

import type { BrowserWindow } from 'electron';
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
import { IpcChannel } from '../../shared/ipc-channels';
import type { AgentId } from '../../shared/types';
import { checkThemeHealth } from '../theme-health-check';
import { type CdpSession, connectCdp } from './cdp-client';
import { type InjectEngineResult, injectThemeViaCdp, removeEngineInjection } from './cdp-inject';
import { findDomTargets } from './cdp-targets';
import { verifyTheme } from './injection/shared';
import {
  attachReloadWatchdog,
  detachReloadWatchdog,
  type ReloadWatchdogDeps,
} from './reload-watchdog';
import { buildSecondaryInjectExpression, buildSecondaryRemoveExpression } from './secondary-inject';
import {
  acquireSession,
  type CdpSessionPool,
  type SessionHandle,
  targetKeyFor,
} from './session-pool';

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
/** Per-target secondary-injection progress event. */
export interface SecondaryInjectProgressEvent {
  agent: string;
  targetId: string;
  targetType: string;
  title?: string;
  success: boolean;
  error?: string;
  elapsed: number;
}

/** Summary event emitted after all secondary targets have been attempted. */
export interface SecondaryInjectSummaryEvent {
  agent: string;
  injected: number;
  failed: number;
  total: number;
  duration: number;
}

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
  /** Main window reference for pushing health reports to the renderer via IPC. */
  mainWindow?: BrowserWindow | null;
  /**
   * Optional callback invoked after each secondary-target injection attempt
   * (progress) and once after all targets have been attempted (summary).
   * When provided, the UI can render a real-time per-target injection timeline.
   */
  onSecondaryProgress?: (event: SecondaryInjectProgressEvent | SecondaryInjectSummaryEvent) => void;
  /**
   * Optional per-agent CDP session pool. When provided, target sessions are
   * reused across the fan-out sub-tasks within a single epoch (secondary inject
   * + hardening + remove) instead of being re-handshaked each time, and pooled
   * sessions are owned by the pool (callers must NOT close them). When omitted,
   * fan-out falls back to connect-then-close one-shot sessions.
   */
  sessions?: CdpSessionPool;
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
  const loopStart = Date.now();
  for (const target of secondary) {
    // Abort if a newer apply/restore superseded this one mid-loop.
    if (!deps.isEpochCurrent(appId, epoch)) {
      deps.log(
        `[secondary] ${appId}: epoch changed, aborting after ${injected}/${secondary.length}`,
      );
      return;
    }
    const targetStart = Date.now();
    let targetSuccess = false;
    let targetError: string | undefined;
    try {
      const handle = await acquireSession(
        deps.sessions,
        appId,
        targetKeyFor(target.id, target.webSocketDebuggerUrl),
        () => connectWithRetry(target.webSocketDebuggerUrl!, 3000),
      );
      const session = handle.session;
      if (!session) {
        failed++;
        targetError = 'connect failed after retries';
        deps.log(
          `[secondary] ${appId}: target ${target.type} "${target.title?.slice(0, 40)}" connect failed after retries`,
        );
        continue;
      }
      try {
        const result = await session.evaluate(expression);
        if (result.includes('"installed":true')) {
          injected++;
          targetSuccess = true;
        } else {
          failed++;
          targetError = `unexpected result: ${result}`;
          deps.log(
            `[secondary] ${appId}: target ${target.type} "${target.title?.slice(0, 40)}" returned: ${result}`,
          );
        }
      } finally {
        // Pooled sessions are owned by the pool — only close one-shot ones.
        if (!handle.pooled) session.close();
      }
    } catch (error) {
      failed++;
      targetError = toMessage(error);
      deps.log(
        `[secondary] ${appId}: target ${target.type} "${target.title?.slice(0, 40)}" evaluate failed: ${targetError}`,
      );
    }
    // Emit per-target progress event for the renderer UI.
    deps.onSecondaryProgress?.({
      agent: appId,
      targetId: target.id ?? `${target.type}-${injected + failed}`,
      targetType: target.type ?? 'unknown',
      title: target.title,
      success: targetSuccess,
      error: targetError,
      elapsed: Date.now() - targetStart,
    });
  }
  deps.log(
    `[secondary] ${appId}: injected CSS into ${injected}/${secondary.length} secondary target(s)` +
      (failed ? ` (${failed} failed)` : '') +
      ` — webviews/iframes on port ${port}`,
  );
  // Emit summary event for the renderer UI.
  deps.onSecondaryProgress?.({
    agent: appId,
    injected,
    failed,
    total: secondary.length,
    duration: Date.now() - loopStart,
  });
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
      const handle = await acquireSession(
        deps.sessions,
        appId,
        targetKeyFor(target.id, target.webSocketDebuggerUrl),
        () => connectCdp(target.webSocketDebuggerUrl!, 3000),
      );
      const session = handle.session;
      if (!session) continue;
      try {
        await session.evaluate(expression);
        removed++;
      } finally {
        if (!handle.pooled) session.close();
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
 * RFC 2026-08-18 P3: hardening is degraded to a **WATCHDOG**. It no longer
 * blindly writes into every target. Before injecting into a `page` target it
 * verifies the engine's owned adoptedStyleSheets (`SHEET_OWNED_FLAG`) are
 * already present:
 *
 *   - present → skip (no second write, no flicker),
 *   - absent  → re-inject once, then return to watchdog state.
 *
 * Non-page targets (webview/iframe) still receive injection on every pass — the
 * core covers only the main page, so these have no other writer and must be
 * (re)applied here.
 *
 * Iterates ALL DOM-bearing CDP targets (page, webview, iframe) so the engine
 * layers (palette/tokens/cosmetic/theme CSS + adapter.mjs) are applied to every
 * user-visible surface. This is critical for apps like WorkBuddy that have 13+
 * CDP targets — previously only the first page was themed, leaving webviews and
 * iframes unstyled.
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
  let watchdogSkipped = 0;
  const secondaryInjected = 0;
  const secondaryFailed = 0;
  let failed = 0;
  let firstSession: CdpSession | null = null;
  let firstPooled = false;
  const secondaryLoopStart = 0;

  for (const target of domTargets) {
    // Abort if a newer apply/restore superseded this one mid-loop.
    if (!deps.isEpochCurrent(appId, epoch)) {
      deps.log(
        `[hardening] ${appId}: epoch changed, aborting after ${engineInjected + legacyInjected}/${domTargets.length}`,
      );
      // Pooled sessions are closed by epoch invalidation; only close one-shot ones.
      if (firstSession && !firstPooled) firstSession.close();
      return;
    }

    let handle: SessionHandle = { session: null, pooled: false };
    try {
      handle = await acquireSession(
        deps.sessions,
        appId,
        targetKeyFor(target.id, target.webSocketDebuggerUrl),
        () => connectWithRetry(target.webSocketDebuggerUrl!, 4000),
      );
    } catch {
      handle = { session: null, pooled: false };
    }
    const session = handle.session;
    if (!session) {
      failed++;
      deps.log(
        `[hardening] ${appId}: ${target.type} "${target.title?.slice(0, 40)}" connect failed after retries`,
      );
      continue;
    }

    try {
      // --- RFC 2026-08-18 P3: watchdog gate (page targets only) ---
      // Verify the engine's owned adoptedStyleSheets are already present. If
      // they are, a previous pass already applied them — inject nothing (skip
      // the duplicate write and the flicker it causes). `verifyTheme` is
      // error-tolerant (returns null on evaluate failure) → treat as "absent"
      // and re-inject. Non-page targets always proceed to injection since they
      // have no other writer.
      const watchdogVerification = target.type === 'page' ? await verifyTheme(session) : null;
      if (watchdogVerification && watchdogVerification.adoptedSheetCount > 0) {
        watchdogSkipped++;
        if (!firstSession) {
          firstSession = session;
          firstPooled = handle.pooled;
        }
        deps.log(
          `[hardening] ${appId}: WATCHDOG skip ${target.type} "${target.title?.slice(0, 40)}" ` +
            `(engine sheets already applied: ${watchdogVerification.adoptedSheetCount})`,
        );
      } else {
        // Inject the engine architecture (palette + tokens + cosmetic + theme +
        // adapter.mjs). `injectThemeViaEngine` internally verifies adoption and
        // returns the per-layer outcome.
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
              `[hardening] ${appId}: ENGINE [${target.type}] layers=${engineResult.layersInjected} ` +
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
                `[hardening] ${appId}: LEGACY [page] css=${result.cssInjected} ` +
                  `hero=${result.heroInjected} ` +
                  `verified=${result.verification?.heroBlobActive ?? 'n/a'} ` +
                  `accent=${result.verification?.accent || '?'}`,
              );
            }
          }
        }
      }

      // Keep the first successful page session for the health check below.
      if (!firstSession && target.type === 'page') {
        firstSession = session;
        firstPooled = handle.pooled;
      }
    } catch (error) {
      failed++;
      deps.log(`[hardening] ${appId}: ${target.type} injection failed: ${toMessage(error)}`);
    } finally {
      // Close one-shot sessions unless kept for the health check. Pooled
      // sessions are owned by the pool and must never be closed here.
      if (!handle.pooled && session !== firstSession) {
        session.close();
      }
    }
  }

  deps.log(
    `[hardening] ${appId}: applied to ${engineInjected + legacyInjected}/${domTargets.length} targets ` +
      `(engine=${engineInjected} legacy=${legacyInjected}` +
      `${watchdogSkipped ? ` watchdog-skip=${watchdogSkipped}` : ''}` +
      `${failed ? ` failed=${failed}` : ''})`,
  );

  // RFC 2026-08-18 P3: arm the cross-navigation reload watchdog on the primary
  // page target. After a reload/navigation the core's persistenceSessions
  // restore the visible theme sheet (R2), but the engine's owned layers
  // (palette/tokens/cosmetic/theme + adapter.mjs) are lost — this long-lived,
  // event-aware session re-verifies them on each document load and re-injects
  // once if missing. Only armed while this epoch is still current (a newer
  // apply/restore would supersede it and manage its own watchdog).
  if (deps.isEpochCurrent(appId, epoch)) {
    const primaryPage = domTargets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (primaryPage?.webSocketDebuggerUrl) {
      const watchdogDeps: ReloadWatchdogDeps = {
        isEpochCurrent: deps.isEpochCurrent,
        tryEngineInjection: deps.tryEngineInjection,
        log: deps.log,
      };
      attachReloadWatchdog({
        appId,
        pageTargetUrl: primaryPage.webSocketDebuggerUrl,
        bundle,
        targetTheme,
        heroDataUrl,
        epoch,
        deps: watchdogDeps,
      });
    }
  }

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
      // Push health report to renderer via IPC (consumed by diagnostics/UI).
      // Optional chaining skips the send when no main window is available.
      deps.mainWindow?.webContents.send(IpcChannel.THEME_HEALTH_REPORT, health);
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
      // Pooled sessions are owned by the pool; only close one-shot ones.
      if (!firstPooled) firstSession.close();
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

  // RFC 2026-08-18 P3: disarm the cross-navigation reload watchdog so a
  // subsequent reload stays clean (remove→reload → no auto re-inject, R4).
  detachReloadWatchdog(appId);

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
      const handle = await acquireSession(
        deps.sessions,
        appId,
        targetKeyFor(target.id, target.webSocketDebuggerUrl),
        () => connectCdp(target.webSocketDebuggerUrl!, 3000),
      );
      const session = handle.session;
      if (!session) continue;
      try {
        // RFC 2026-08-18 P2: removeEngineInjection no longer removes any
        // tracked new-document script (that persistence is core-owned); it
        // only sets the shared disable flag + clears engine layers/sheets.
        await removeEngineInjection(session);
        removed++;
      } finally {
        if (!handle.pooled) session.close();
      }
    } catch {
      // Best-effort — target may have navigated away or closed.
    }
  }
  deps.log(
    `[hardening-remove] ${appId}: removed engine from ${removed}/${domTargets.length} target(s)`,
  );
}

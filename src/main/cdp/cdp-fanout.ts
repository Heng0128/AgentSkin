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
import { isThemeFullyApplied } from '../../shared/injection-runtime';
import { IpcChannel } from '../../shared/ipc-channels';
import type { AgentId } from '../../shared/types';
import { checkThemeHealth } from '../theme-health-check';
import { type CdpSession, connectCdp } from './cdp-client';
import { type InjectEngineResult, injectThemeViaCdp, removeEngineInjection } from './cdp-inject';
import { type CdpTarget, findDomTargets } from './cdp-targets';
import { verifyTheme } from './injection/shared';
import {
  attachReloadWatchdog,
  detachReloadWatchdog,
  type ReloadWatchdogDeps,
} from './reload-watchdog';
import { pickPrimaryRenderer, type RendererHints } from './renderer-rank';
import { buildSecondaryInjectExpression, buildSecondaryRemoveExpression } from './secondary-inject';
import {
  acquireSession,
  type CdpSessionPool,
  releaseSession,
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
    imageDataUrls: Record<string, string> | null,
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
  //
  // RFC A2 P2: we keep iterating ALL DOM targets (webview/iframe are filtered
  // out of matchTarget and MUST still receive the lightweight CSS-only
  // injection below — narrowing to the matchTarget-compatible set would regress
  // WorkBuddy's multi-surface theming). Instead we unify the PRIMARY renderer
  // decision on `rendererHints`: the semantic-anchor page (when declared) is
  // hoisted to the front of the loop and becomes the `firstSession`/health
  // target, so "which page is the main window" no longer depends on list order.
  let domTargets = await findDomTargets(port);
  if (!domTargets.length) {
    deps.log(`[hardening] ${appId}: no DOM-bearing targets on port ${port}`);
    return;
  }

  // Resolve the primary page target via the adapter's rendererHints (RFC A2 P2).
  // Only page-type targets are candidates; hints are optional — when absent,
  // fall back to the first page target (historic behavior). We read the raw
  // unknown-typed accessor and normalize to RendererHints.
  let primaryPage: CdpTarget | undefined = domTargets.find(
    (t) => t.type === 'page' && t.webSocketDebuggerUrl,
  );
  const rawHints = adapter.rendererHints?.() as RendererHints | undefined;
  if (rawHints) {
    const ranked = pickPrimaryRenderer(
      rawHints,
      domTargets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl),
    );
    if (ranked) primaryPage = ranked;
    // Hoist the primary page to the front so the engine layer + health check
    // run on the main window first (not whatever /json/list returns first).
    const withoutPrimary = domTargets.filter((t) => !(t.id === primaryPage?.id));
    if (withoutPrimary.length < domTargets.length) {
      domTargets = primaryPage ? [primaryPage, ...withoutPrimary] : domTargets;
    }
  }

  // 2a multi-asset: resolve the FULL image set (not just hero) the same way
  // the secondary-inject and renderer-payload paths do — imageDataUrls wins,
  // artDataUrl backfills hero when imageDataUrls lacks it.
  const imageDataUrls = {
    ...(targetTheme.imageDataUrls ?? {}),
    ...(!targetTheme.imageDataUrls?.hero && targetTheme.artDataUrl
      ? { hero: targetTheme.artDataUrl }
      : {}),
  };
  const resolvedImages = Object.keys(imageDataUrls).length > 0 ? imageDataUrls : null;
  let engineInjected = 0;
  let legacyInjected = 0;
  let watchdogSkipped = 0;
  let secondaryInjected = 0;
  let secondaryFailed = 0;
  let failed = 0;
  let firstSession: CdpSession | null = null;
  let firstPooled = false;
  let firstSessionTargetKey: string | null = null;
  let secondaryLoopStart = 0;

  for (const target of domTargets) {
    // Abort if a newer apply/restore superseded this one mid-loop.
    if (!deps.isEpochCurrent(appId, epoch)) {
      deps.log(
        `[hardening] ${appId}: epoch changed, aborting after ${engineInjected + legacyInjected}/${domTargets.length}`,
      );
      // Release firstSession (pooled or one-shot).
      if (firstSession) {
        if (firstPooled && firstSessionTargetKey) {
          releaseSession(deps.sessions, appId, firstSessionTargetKey);
        } else {
          firstSession.close();
        }
      }
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
      if (target.type === 'page') {
        // --- RFC 2026-08-18 P3: watchdog gate (page targets only) ---
        // Verify the engine's owned adoptedStyleSheets are already present. If
        // they are, a previous pass already applied them — inject nothing (skip
        // the duplicate write and the flicker it causes). `verifyTheme` is
        // error-tolerant (returns null on evaluate failure) → treat as "absent"
        // and re-inject. Page targets are covered by core applyTheme + this
        // engine layer, so the watchdog only skips when those are verified.
        const watchdogVerification = await verifyTheme(session);
        if (watchdogVerification && isThemeFullyApplied(watchdogVerification)) {
          watchdogSkipped++;
          if (!firstSession) {
            firstSession = session;
            firstPooled = handle.pooled;
            firstSessionTargetKey = targetKeyFor(target.id, target.webSocketDebuggerUrl);
          }
          const layerDetail = watchdogVerification.layers
            ? Object.entries(watchdogVerification.layers)
                .map(([k, v]) => `${k}:${v}`)
                .join(',')
            : 'legacy';
          deps.log(
            `[hardening] ${appId}: WATCHDOG skip ${target.type} "${target.title?.slice(0, 40)}" ` +
              `(accent=${watchdogVerification.accent || '?'}, sheets=${watchdogVerification.adoptedSheetCount}, layers=[${layerDetail}])`,
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
            resolvedImages,
          );

          if (engineResult) {
            engineInjected++;
            if (!firstSession) {
              deps.log(
                `[hardening] ${appId}: ENGINE [${target.type}] layers=${engineResult.layersInjected} ` +
                  `adapter=${engineResult.adapterApplied} hero=${engineResult.heroInjected} ` +
                  `images=${engineResult.imagesInjected} ` +
                  `accent=${engineResult.verification?.accent || '?'}`,
              );
            }
          } else {
            // Fallback: legacy single-CSS injection (when engine files missing).
            // Page targets can still fall back to the core's CSS.
            const result = await injectThemeViaCdp(session, {
              css: targetTheme.css,
              imageDataUrls: resolvedImages,
              hostClass: hostClassFor(appId),
              retries: 1,
              verifyDelayMs: DEFAULT_VERIFY_DELAY_MS,
            });
            legacyInjected++;
            if (!firstSession) {
              deps.log(
                `[hardening] ${appId}: LEGACY [page] css=${result.cssInjected} ` +
                  `hero=${result.heroInjected} images=${result.imagesInjected} ` +
                  `verified=${result.verification?.heroBlobActive ?? 'n/a'} ` +
                  `accent=${result.verification?.accent || '?'}`,
              );
            }
          }
        }

        // Keep the first successful page session for the health check below.
        if (!firstSession && target.type === 'page') {
          firstSession = session;
          firstPooled = handle.pooled;
          firstSessionTargetKey = targetKeyFor(target.id, target.webSocketDebuggerUrl);
        }
      } else {
        // --- Non-page targets (webview / iframe): lightweight CSS-only ---
        // These (MCP webviews, ardot iframes) are filtered out of the core's
        // matchTarget/preflight, so they have no other writer. Inject the CSS
        // variables + stylesheet + host class via buildSecondaryInjectExpression
        // exactly once here — the previous architecture ALSO injected these
        // targets with the full engine layer via a separate injectSecondaryTargets
        // pass, double-writing them. This loop is now their single channel.
        if (secondaryLoopStart === 0) secondaryLoopStart = Date.now();
        const targetStart = Date.now();
        let targetSuccess = false;
        let targetError: string | undefined;
        let targetResult = '';
        try {
          targetResult = await session.evaluate(buildSecondaryInjectExpression(appId, targetTheme));
          if (targetResult.includes('"installed":true')) {
            targetSuccess = true;
            secondaryInjected++;
          } else {
            targetError = `unexpected result: ${targetResult}`;
            secondaryFailed++;
          }
        } catch (error) {
          targetError = toMessage(error);
          secondaryFailed++;
        }
        // Emit per-target progress event for the renderer timeline.
        deps.onSecondaryProgress?.({
          agent: appId,
          targetId: target.id ?? `secondary-${secondaryInjected + secondaryFailed}`,
          targetType: target.type ?? 'unknown',
          title: target.title,
          success: targetSuccess,
          error: targetError,
          elapsed: Date.now() - targetStart,
        });
      }
    } catch (error) {
      failed++;
      deps.log(`[hardening] ${appId}: ${target.type} injection failed: ${toMessage(error)}`);
    } finally {
      if (handle.pooled) {
        // 归还引用计数；pool 拥有生命周期，不可 close
        releaseSession(deps.sessions, appId, targetKeyFor(target.id, target.webSocketDebuggerUrl));
      } else if (session !== firstSession) {
        try {
          session.close();
        } catch {
          /* ignore close errors */
        }
      }
    }
  }

  // Emit the non-page summary event (mirrors the former injectSecondaryTargets
  // summary) once all secondary targets have been attempted — only when there
  // were any to report.
  if (secondaryLoopStart > 0) {
    deps.onSecondaryProgress?.({
      agent: appId,
      injected: secondaryInjected,
      failed: secondaryFailed,
      total: secondaryInjected + secondaryFailed,
      duration: Date.now() - secondaryLoopStart,
    });
  }

  deps.log(
    `[hardening] ${appId}: applied to ${engineInjected + legacyInjected}/${domTargets.length} targets ` +
      `(engine=${engineInjected} legacy=${legacyInjected}` +
      `${secondaryInjected ? ` secondary=${secondaryInjected}` : ''}` +
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
        imageDataUrls: resolvedImages,
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
      if (firstPooled && firstSessionTargetKey) {
        // 归还 firstSession 的引用计数
        releaseSession(deps.sessions, appId, firstSessionTargetKey);
      } else {
        firstSession?.close();
      }
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
        if (target.type === 'page') {
          // RFC 2026-08-18 P2: removeEngineInjection no longer removes any
          // tracked new-document script (that persistence is core-owned); it
          // only sets the shared disable flag + clears engine layers/sheets.
          await removeEngineInjection(session);
        } else {
          // Non-page targets were lightweight-CSS-injected by hardeningPass —
          // strip that single <style> + host class + CSS variables here (the
          // CSS-only clean counterpart, mirroring the injection split).
          await session.evaluate(buildSecondaryRemoveExpression(appId));
        }
        removed++;
      } finally {
        if (handle.pooled) {
          releaseSession(
            deps.sessions,
            appId,
            targetKeyFor(target.id, target.webSocketDebuggerUrl),
          );
        } else {
          try {
            session.close();
          } catch {
            /* ignore close errors */
          }
        }
      }
    } catch {
      // Best-effort — target may have navigated away or closed.
    }
  }
  deps.log(
    `[hardening-remove] ${appId}: removed engine from ${removed}/${domTargets.length} target(s)`,
  );
}

// ---------------------------------------------------------------------------
// Backward-compatible aliases
// ---------------------------------------------------------------------------

/**
 * @deprecated Use {@link hardeningPass} instead. Kept for backward compatibility
 * with delegates.ts and test mocks. `hardeningPass` now handles both page
 * engine injection AND secondary (webview/iframe) CSS injection in a unified loop.
 */
export const injectSecondaryTargets = hardeningPass;

/**
 * @deprecated Use {@link hardeningRemove} instead. Kept for backward compatibility
 * with delegates.ts and test mocks. `hardeningRemove` now strips engine layers
 * from all DOM-bearing targets (page + webview + iframe).
 */
export const removeSecondaryTargets = hardeningRemove;

// SPDX-License-Identifier: MPL-2.0

/**
 * # Tweak Injector — Live Preview Bridge
 *
 * Real-time override push from the Workbench "Live Tweak" panel into running
 * agent applications — no full theme re-apply required.
 *
 * ## Layering
 *
 *   UI (Workbench panel)
 *     → IPC (renderer → main)
 *       → `pushTweak` / `saveTweakAsCustomCss` / `resetTweak` (this module)
 *         → CDP session (per agent, resolved from port)
 *           → `injectCssLayer(session, 'workspace-tweak', css)`
 *
 * The `workspace-tweak` layer is independent of the theme layer, so live
 * tweaks never disturb the applied theme. On full theme apply, the injector
 * layer is untouched; on reset, only this layer is cleared.
 *
 * ## Dependency direction
 *
 * This module imports `ToolOverride` and `TweakSession` from
 * `src/shared/types/override.ts` — pure types with no React/DOM
 * dependencies, safe for the main process. The `overridesToCss` function
 * could NOT be imported because it lives inside a React component file
 * (`RealDomPreview.tsx`); a local simplified implementation lives here
 * instead.
 */

import { toMessage } from '../../shared/errors';
import { sanitizeCSS } from '../../shared/safe-css';
import type { AgentId } from '../../shared/types';
import type { ToolOverride, TweakSession } from '../../shared/types/override';

export type { TweakSession } from '../../shared/types/override';

import { type CdpSession, connectCdp } from '../cdp/cdp-client';
import { injectCssLayer } from '../cdp/injection/shared';
import { mainWarn } from '../logger';
import type { SettingsServiceApi } from './contracts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Named layer used for live-tweak overrides. Independent of the theme layer. */
const TWEAK_LAYER_NAME = 'workspace-tweak';

/** Comment header prepended to tweak CSS chunks saved into customThemeCss. */
const TWEAK_CSS_HEADER = '/* AgentSkin: workspace tweak */';

// ---------------------------------------------------------------------------
// CDP target discovery + session resolution
// ---------------------------------------------------------------------------

interface CdpTarget {
  type?: string;
  webSocketDebuggerUrl?: string;
  url?: string;
  title?: string;
}

/**
 * Resolve a CDP page session from an agent's debug port.
 *
 * Fetches `http://127.0.0.1:{port}/json/list` to discover attached targets,
 * picks the first `page` target, and establishes a typed CDP session via
 * `connectCdp`. Returns `null` when the port is unreachable, has no page
 * target, or connection times out.
 */
export async function resolveSessionForPort(port: number): Promise<CdpSession | null> {
  let targets: CdpTarget[];
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return null;
    const raw: unknown = await response.json();
    if (!Array.isArray(raw)) return null;
    targets = raw as CdpTarget[];
  } catch {
    return null;
  }

  const pageTarget = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!pageTarget?.webSocketDebuggerUrl) return null;

  try {
    return await connectCdp(pageTarget.webSocketDebuggerUrl, 2000, 3000);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// simplified overridesToCss
// ---------------------------------------------------------------------------
// A local implementation because the canonical `overridesToCss` lives inside
// `RealDomPreview.tsx` (React component with DOM deps) and cannot be imported
// into the main process without violating the L4 boundary.
//
// Covers all ToolOverride fields that map to CSS custom properties or
// short standalone rules — enough for live-tweak preview. Fields handled:
//   shape:       radius, spacing, shadowLevel, blurPx, borderWidth
//   typography:  fontSize, fontFam, lineHeight
//   motion:      duration, timing
//   color:       accent, background, foreground, surface, colors (semantic palette)
//   structure:   separators
//   layout:      scale
//   filter:      invert, contrast, saturate
//   effects:     dim, opacity
//   gradient:    gradientAccent
//
// The full version in `dom-export.ts` additionally performs role-based color
// rebinding inside DOM node replay — irrelevant here because the injector
// targets raw CSS custom properties only.

function overridesToCssSimple(overrides: ToolOverride): string {
  const root: string[] = [];
  const extra: string[] = [];
  if (overrides.radius) root.push(`--as-radius:${overrides.radius}`);
  if (typeof overrides.spacing === 'number') root.push(`--as-spacing:${overrides.spacing}px`);
  if (overrides.shadowLevel && overrides.shadowLevel !== 'none')
    root.push(`--as-shadow:${shadowFromLevel(overrides.shadowLevel)}`);
  if (typeof overrides.blurPx === 'number') root.push(`--as-blur:blur(${overrides.blurPx}px)`);
  if (typeof overrides.fontSize === 'number') root.push(`--as-fontsize:${overrides.fontSize}px`);
  if (overrides.fontFam) root.push(`--as-fontfam:${overrides.fontFam}`);
  if (overrides.duration) root.push(`--as-duration:${overrides.duration}`);
  if (overrides.timing) root.push(`--as-timing:${overrides.timing}`);
  if (overrides.accent) root.push(`--as-accent:${overrides.accent}`);
  if (overrides.background) root.push(`--as-bg:${overrides.background}`);
  if (overrides.foreground) root.push(`--as-fg:${overrides.foreground}`);
  if (overrides.surface) root.push(`--as-surface:${overrides.surface}`);
  if (typeof overrides.borderWidth === 'number')
    root.push(`--as-border:${overrides.borderWidth}px`);
  if (typeof overrides.lineHeight === 'number') root.push(`--as-lh:${overrides.lineHeight}`);
  if (overrides.separators === false) root.push(`--as-sep:transparent`);

  // colors: semantic palette — merge known role keys into root variables.
  // Only the four core roles are mapped; extra palette keys are ignored
  // because they have no predefined --as-* custom property.
  if (overrides.colors) {
    if (overrides.colors.accent) root.push(`--as-accent:${overrides.colors.accent}`);
    if (overrides.colors.background) root.push(`--as-bg:${overrides.colors.background}`);
    if (overrides.colors.foreground) root.push(`--as-fg:${overrides.colors.foreground}`);
    if (overrides.colors.surface) root.push(`--as-surface:${overrides.colors.surface}`);
  }

  // gradientAccent — bake a gradient var and apply it as background-image.
  // Reference: dom-export.ts L312-317.
  if (overrides.gradientAccent) {
    root.push(
      '--as-grad: linear-gradient(135deg, var(--as-accent, #3b82f6) 0%, var(--as-bg, #ffffff) 72%)',
    );
    extra.push('html,body{background-image:var(--as-grad,none)}');
  }

  // scale — body transform (preview-only).
  // Reference: dom-export.ts L323-324.
  if (typeof overrides.scale === 'number' && overrides.scale !== 1) {
    extra.push(`body{transform:scale(${overrides.scale});transform-origin:top left}`);
  }

  // filter chain — invert + contrast + saturate (preview-only).
  // Reference: dom-export.ts L325-329.
  const filters: string[] = [];
  if (overrides.invert) filters.push('invert(1) hue-rotate(180deg)');
  if (typeof overrides.contrast === 'number' && overrides.contrast !== 1)
    filters.push(`contrast(${overrides.contrast})`);
  if (typeof overrides.saturate === 'number' && overrides.saturate !== 1)
    filters.push(`saturate(${overrides.saturate})`);
  if (filters.length) extra.push(`html{filter:${filters.join(' ')}}`);

  // dim — fixed full-screen dark overlay via body::before (preview-only).
  // Reference: dom-export.ts L330-335.
  if (typeof overrides.dim === 'number' && overrides.dim > 0) {
    extra.push(
      `body::before{content:"";position:fixed;inset:0;background:rgba(0,0,0,${overrides.dim});pointer-events:none;z-index:99999}`,
    );
  }

  // opacity — body-level transparency (preview-only).
  // Reference: dom-export.ts L336-338.
  if (typeof overrides.opacity === 'number' && overrides.opacity < 1) {
    extra.push(`body{opacity:${overrides.opacity}}`);
  }

  if (!root.length && !extra.length) return '';

  // Combine :root{} block (if any) with extra standalone rules, then sanitize.
  // User-controlled values (fontFam, accent, colors…) flow into CSS and must be
  // checked for breakout payloads ("</style><script>", expression(), external
  // url() exfil, etc). The renderer-side equivalent in RealDomPreview.tsx already
  // sanitizes via sanitizeCSS; the main-process injector must apply the same guard
  // because it reaches a live CDP target directly.
  const blocks: string[] = [];
  if (root.length) blocks.push(`:root{${root.join(';')}}`);
  blocks.push(...extra);
  const rawCss = blocks.join('');
  const sanitized = sanitizeCSS(rawCss);
  return sanitized.clean;
}

function shadowFromLevel(level: string): string {
  switch (level) {
    case 'sm':
      return '0 1px 3px rgba(0,0,0,.18)';
    case 'md':
      return '0 4px 12px rgba(0,0,0,.22)';
    case 'lg':
      return '0 8px 24px rgba(0,0,0,.28)';
    case 'xl':
      return '0 16px 40px rgba(0,0,0,.34)';
    default:
      return 'none';
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Push current overrides to a running agent via a temporary CDP layer.
 *
 * Converts `ToolOverride` → CSS custom properties, then injects them as the
 * `workspace-tweak` named layer. This layer is independent of the theme layer,
 * so the applied theme remains untouched.
 *
 * @returns `true` if CSS was injected successfully, `false` if the CDP session
 *          was unreachable or injection failed.
 */
export async function pushTweak(session: TweakSession, overrides: ToolOverride): Promise<boolean> {
  const css = overridesToCssSimple(overrides);
  if (!css) return false;

  // Mirror pushed overrides onto the session so any subsequent reader of
  // session.overrides (logging, future save calls, etc.) sees the same snapshot.
  session.overrides = overrides;

  const cdpSession = await resolveSessionForPort(session.port);
  if (!cdpSession) {
    mainWarn('Tweak.Inject', `no CDP session on port ${session.port} for ${session.agentId}`);
    return false;
  }

  try {
    const ok = await injectCssLayer(cdpSession, TWEAK_LAYER_NAME, css);
    return ok;
  } catch (error) {
    mainWarn('Tweak.Inject', `push failed for ${session.agentId}: ${toMessage(error)}`);
    return false;
  } finally {
    cdpSession.close();
  }
}

/**
 * Persist the current tweak overrides into `customThemeCss` settings.
 *
 * The existing CSS from `customThemeCss()` is read first, the new tweak CSS
 * block (with a distinguishing comment header) is appended, and the combined
 * result is saved via `setCustomThemeCss`. This makes live tweaks survive
 * across app restarts without consuming a slot in the theme library.
 *
 * After a successful save, `session.dirty` is set to `false`.
 *
 * @returns `true` if settings were updated, `false` if the CSS is empty or
 *          the session port has no reachable agent.
 */
export async function saveTweakAsCustomCss(
  session: TweakSession,
  settings: SettingsServiceApi,
  overrides: ToolOverride,
): Promise<boolean> {
  // Accepts `overrides` explicitly (instead of always reading session.overrides)
  // so the caller controls which snapshot is persisted. This matches pushTweak's
  // signature and prevents accidental mismatch when the renderer pushes one set
  // of overrides but saves another.
  const css = overridesToCssSimple(overrides);
  if (!css) return false;

  const block = `${TWEAK_CSS_HEADER}\n${css}`;
  const existing = settings.customThemeCss();
  const combined = existing ? `${existing}\n${block}` : block;

  try {
    await settings.setCustomThemeCss(combined);
    session.dirty = false;
    mainWarn('Tweak.Save', `saved tweak CSS for ${session.agentId} (${block.length}B)`);
    return true;
  } catch (error) {
    mainWarn('Tweak.Save', `save failed for ${session.agentId}: ${toMessage(error)}`);
    return false;
  }
}

/**
 * Clear the tweak layer for an agent — resetting live overrides without
 * affecting the applied theme.
 *
 * Injects empty CSS into the `workspace-tweak` layer, which the injection
 * runtime handles by removing the layer entirely.
 *
 * @returns `true` if the layer was cleared, `false` if the CDP session was
 *          unreachable.
 */
export async function resetTweak(agentId: AgentId, port: number): Promise<boolean> {
  const cdpSession = await resolveSessionForPort(port);
  if (!cdpSession) {
    mainWarn('Tweak.Reset', `no CDP session on port ${port} for ${agentId}`);
    return false;
  }

  try {
    // Injecting empty CSS removes the named layer in the adoption runtime.
    const ok = await injectCssLayer(cdpSession, TWEAK_LAYER_NAME, '');
    return ok;
  } catch (error) {
    mainWarn('Tweak.Reset', `reset failed for ${agentId}: ${toMessage(error)}`);
    return false;
  } finally {
    cdpSession.close();
  }
}

// SPDX-License-Identifier: MPL-2.0

/**
 * # css-service
 *
 * Thin wrapper over the CDP CSS domain for reading agent stylesheet metadata
 * and text content. Used by the CSS source editor (CenterTabRaw) to populate
 * the stylesheet list and load editable CSS without introducing a new
 * injection mechanism — edited CSS flows through the existing `workspace-tweak`
 * layer via `pushTweak`.
 *
 * ## Design notes
 *
 * CDP has no `getAllStyleSheets` command. Stylesheet discovery is done via
 * `Runtime.evaluate` on `document.styleSheets`, which exposes href/title/
 * disabled/isInline and the parsed rule set. We derive a synthetic
 * `styleSheetId` (`sheet-index-N`) so the renderer can address a sheet by
 * position without needing CDP event sessions.
 *
 * Text reconstruction iterates `cssRules[].cssText` — the browser's parsed
 * rule representation is lossy vs. the original source (comments/whitespace
 * dropped), but sufficient for an editor that re-injects through the
 * workspace-tweak layer rather than rewriting the original `<style>`/`<link>`.
 */

import { toMessage } from '../../shared/errors';
import { mainWarn } from '../logger';
import type { CdpSession } from './cdp-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Metadata for a single stylesheet discovered on the agent page. */
export interface StyleSheetInfo {
  /**
   * Synthetic id (`sheet-index-N`) addressing the sheet by DOM position.
   * Pass to {@link getStyleSheetText} to read its content.
   */
  styleSheetId: string;
  /** Sheet URL for `<link>` sheets, empty string for inline `<style>` sheets. */
  url: string;
  /** `true` if the sheet is currently disabled. */
  disabled: boolean;
  /** `true` for inline `<style>` elements (no href). */
  isInline: boolean;
  /** The stylesheet's `sourceURL` (same as `url` for link sheets). */
  sourceURL: string;
  /** Approximate content length in characters (sum of `rule.cssText.length`). */
  length: string;
  /** Human label: href basename or "(inline)". */
  label: string;
}

// ---------------------------------------------------------------------------
// CDP domain enable
// ---------------------------------------------------------------------------

/** Enable the CSS domain so subsequent CSS commands are accepted. */
export async function enableCSS(session: CdpSession): Promise<void> {
  await session.send('CSS.enable');
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * List all stylesheets on the current page with metadata only (no text).
 *
 * Best-effort — a CORS-cross-origin sheet throws on `cssRules` access and is
 * reported with `length: 'unknown'` so the editor can still list it.
 */
export async function listStyleSheets(session: CdpSession): Promise<StyleSheetInfo[]> {
  try {
    await enableCSS(session);
  } catch (error) {
    mainWarn('CssService.List', `CSS.enable failed: ${toMessage(error)}`);
    // Continue anyway — Runtime.evaluate path doesn't strictly require it.
  }

  const raw = await session.evaluate(`(() => {
    const sheets = document.styleSheets;
    const out = [];
    for (let i = 0; i < sheets.length; i++) {
      try {
        const s = sheets[i];
        const rules = s.cssRules || s.rules || [];
        let len = 0;
        for (const r of rules) len += (r.cssText || '').length;
        out.push({
          url: s.href || '',
          disabled: !!s.disabled,
          isInline: !s.href,
          sourceURL: s.href || '',
          length: len,
          title: s.title || '',
        });
      } catch (e) {
        out.push({ url: '', disabled: false, isInline: false, sourceURL: '', length: -1, title: 'CORS-blocked' });
      }
    }
    return JSON.stringify(out);
  })()`);

  let parsed: Array<{
    url: string;
    disabled: boolean;
    isInline: boolean;
    sourceURL: string;
    length: number;
    title: string;
  }>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    mainWarn('CssService.List', `JSON.parse failed on evaluate result: ${raw.slice(0, 100)}`);
    return [];
  }

  return parsed.map((entry, index) => {
    const url = entry.url || '';
    const label = url ? url.split('/').pop()?.split('?')[0] || url : '(inline)';
    return {
      styleSheetId: `sheet-index-${index}`,
      url,
      disabled: entry.disabled,
      isInline: entry.isInline,
      sourceURL: entry.sourceURL,
      length: entry.length < 0 ? 'unknown' : String(entry.length),
      label,
    } satisfies StyleSheetInfo;
  });
}

// ---------------------------------------------------------------------------
// Text retrieval
// ---------------------------------------------------------------------------

/**
 * Read the parsed CSS text of a stylesheet addressed by its synthetic id
 * (`sheet-index-N`, obtained from {@link listStyleSheets}).
 *
 * Reconstructs text from `document.styleSheets[N].cssRules[].cssText` — the
 * browser's parsed representation. Lossy vs. original source (comments,
 * formatting), but accurate for rule content.
 *
 * Returns empty string when the index is out of range or the sheet is
 * CORS-blocked.
 */
export async function getStyleSheetText(
  session: CdpSession,
  styleSheetId: string,
): Promise<string> {
  const match = /^sheet-index-(\d+)$/.exec(styleSheetId);
  if (!match) {
    mainWarn('CssService.Text', `invalid styleSheetId: ${styleSheetId}`);
    return '';
  }
  const idx = Number(match[1]);
  // Build the expression carefully — idx is numeric, no injection risk.
  const expression = `(() => {
    const sheet = document.styleSheets[${idx}];
    if (!sheet) return '';
    let rules;
    try { rules = sheet.cssRules || sheet.rules || []; } catch (e) { return ''; }
    return Array.from(rules).map(r => r.cssText).join('\\n');
  })()`;

  try {
    const raw = await session.evaluate(expression);
    // evaluate returns the string "null" when the page expression evaluates to
    // JS null (e.g. sheet index out of range → `document.styleSheets[N]` is undefined).
    if (raw === 'null' || raw === 'undefined' || typeof raw !== 'string') return '';
    return raw;
  } catch (error) {
    mainWarn('CssService.Text', `evaluate failed for ${styleSheetId}: ${toMessage(error)}`);
    return '';
  }
}

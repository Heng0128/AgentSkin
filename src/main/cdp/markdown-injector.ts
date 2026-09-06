// SPDX-License-Identifier: MPL-2.0

/**
 * # markdown-injector
 *
 * Runtime Markdown style injection via CDP. Inserts a `<style>` tag into the
 * active renderer document to customize Markdown rendering appearance
 * (headings, links, code blocks, inline code, blockquotes, fonts).
 *
 * ## Safety model
 *
 *   - Does NOT modify app.asar — injection is purely in-memory.
 *   - Styles are automatically cleared on app restart (no persistence).
 *   - The `<style>` tag is tagged with `data-agentskin-markdown` so it can be
 *     removed or updated without affecting other stylesheets.
 *
 * ## Selector coverage
 *
 * Targets both semantic HTML elements and common Markdown-renderer class
 * names (`.markdown-body`, `.prose`, `.message-content`) to cover the
 * majority of agent renderers without per-adapter selectors.
 */

import { toMessage } from '../../shared/errors';
import {
  type MarkdownInjectResult,
  type MarkdownStyles,
  MONOSPACE_FONT_CHAIN,
} from '../../shared/types/markdown';
import { mainWarn } from '../logger';
import type { CdpSession } from './cdp-client';

/** Unique attribute marker for the injected Markdown style element. */
const MARKDOWN_STYLE_ATTR = 'data-agentskin-markdown';

/**
 * Build the CSS string from a MarkdownStyles configuration.
 * Only generates rules for fields that are defined.
 */
export function buildMarkdownCss(styles: MarkdownStyles): string {
  const rules: string[] = [];

  const containerSelectors = [
    '.markdown-body',
    '.prose',
    '.message-content',
    '.chat-content',
    '.agent-response',
    '[class*="markdown"]',
    '[class*="Markdown"]',
  ].join(', ');

  // --- Headings ---
  if (styles.headingColor) {
    rules.push(
      `${containerSelectors} h1, ${containerSelectors} h2, ${containerSelectors} h3, ${containerSelectors} h4, ${containerSelectors} h5, ${containerSelectors} h6 { color: ${styles.headingColor}; }`,
    );
  }
  if (styles.headingColorH1) {
    rules.push(`${containerSelectors} h1 { color: ${styles.headingColorH1}; }`);
  }
  if (styles.headingColorH2) {
    rules.push(`${containerSelectors} h2 { color: ${styles.headingColorH2}; }`);
  }
  if (styles.headingColorH3) {
    rules.push(`${containerSelectors} h3 { color: ${styles.headingColorH3}; }`);
  }

  // --- Links ---
  if (styles.linkColor) {
    rules.push(`${containerSelectors} a { color: ${styles.linkColor}; }`);
  }

  // --- Code blocks ---
  if (styles.codeBackground) {
    rules.push(`${containerSelectors} pre { background-color: ${styles.codeBackground}; }`);
    rules.push(`${containerSelectors} pre > code { background-color: ${styles.codeBackground}; }`);
  }
  if (styles.codeColor) {
    rules.push(`${containerSelectors} pre { color: ${styles.codeColor}; }`);
    rules.push(`${containerSelectors} pre > code { color: ${styles.codeColor}; }`);
  }

  // --- Inline code ---
  if (styles.inlineCodeColor) {
    rules.push(`${containerSelectors} code:not(pre code) { color: ${styles.inlineCodeColor}; }`);
  }

  // --- Blockquotes ---
  if (styles.blockquoteColor) {
    rules.push(`${containerSelectors} blockquote { color: ${styles.blockquoteColor}; }`);
  }

  // --- Font family ---
  if (styles.fontFamily) {
    rules.push(`${containerSelectors} { font-family: ${styles.fontFamily}; }`);
    // Apply monospace chain to code elements, with user font as primary for pre
    rules.push(
      `${containerSelectors} pre, ${containerSelectors} code { font-family: ${styles.fontFamily}, ${MONOSPACE_FONT_CHAIN}; }`,
    );
  }

  return rules.join('\n');
}

/**
 * Build the JS IIFE expression that injects the Markdown CSS via a <style>
 * element. Idempotent — removes any previously injected Markdown style
 * element before inserting the new one.
 *
 * Returns `'ok:<ruleCount>'` on success or `'err:<message>'` on failure.
 */
function buildInjectExpression(css: string): string {
  const escaped = css.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
  return `(() => {
    try {
      const attr = '${MARKDOWN_STYLE_ATTR}';
      const prev = document.querySelector('style[' + attr + ']');
      if (prev) prev.remove();
      const style = document.createElement('style');
      style.setAttribute(attr, 'true');
      style.textContent = \`${escaped}\`;
      (document.head || document.documentElement).appendChild(style);
      return 'ok:' + (style.sheet ? style.sheet.cssRules.length : 0);
    } catch(e) { return 'err:' + e.message; }
  })()`;
}

/**
 * Inject Markdown styles into the active renderer document via CDP.
 *
 * Creates a `<style>` element tagged with `data-agentskin-markdown` and
 * appends it to `document.head`. Any previously injected Markdown style
 * element is removed first (idempotent).
 *
 * @param session  Active CDP session to the target renderer.
 * @param styles   Markdown style configuration (only defined fields are applied).
 * @returns        Injection result with success status and rule count.
 */
export async function injectMarkdownStyles(
  session: CdpSession,
  styles: MarkdownStyles,
): Promise<MarkdownInjectResult> {
  const css = buildMarkdownCss(styles);

  if (!css) {
    return { success: true, ruleCount: 0 };
  }

  try {
    const expression = buildInjectExpression(css);
    const result = await session.evaluate(expression);

    if (typeof result !== 'string' || !result.startsWith('ok:')) {
      const detail = String(result).slice(0, 120);
      mainWarn('MarkdownInject', `evaluate returned non-ok: ${detail}`);
      return { success: false, ruleCount: 0, error: detail };
    }

    const ruleCount = Number.parseInt(result.slice(3), 10);
    return { success: true, ruleCount: Number.isNaN(ruleCount) ? 0 : ruleCount };
  } catch (error) {
    mainWarn('MarkdownInject', `CDP evaluate failed: ${toMessage(error)}`);
    return { success: false, ruleCount: 0, error: toMessage(error) };
  }
}

/**
 * Remove previously injected Markdown styles from the renderer document.
 *
 * Best-effort — silently ignores errors (the style element may not exist
 * if injection was never called or the document has navigated away).
 *
 * @param session  Active CDP session to the target renderer.
 */
export async function removeMarkdownStyles(session: CdpSession): Promise<void> {
  try {
    const expression = `(() => {
      const attr = '${MARKDOWN_STYLE_ATTR}';
      const prev = document.querySelector('style[' + attr + ']');
      if (prev) prev.remove();
      return 'ok';
    })()`;
    await session.evaluate(expression);
  } catch (error) {
    mainWarn('MarkdownInject', `remove failed (best-effort): ${toMessage(error)}`);
  }
}

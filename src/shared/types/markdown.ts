// SPDX-License-Identifier: MPL-2.0

/**
 * # markdown
 *
 * Runtime Markdown style configuration for agent renderers.
 *
 * These styles are injected via CDP into the active renderer document at
 * runtime — they do NOT modify app.asar and are automatically cleared on
 * app restart. The injection targets common Markdown rendering selectors
 * (headings, links, code blocks, inline code, blockquotes) used by
 * AI-agent chat surfaces.
 *
 * ## Selector strategy
 *
 * The injector targets both semantic HTML elements (`h1`–`h6`, `a`,
 * `pre`, `code`, `blockquote`) and common Markdown-renderer class names
 * (`.markdown-body`, `.prose`, `.message-content`). This dual approach
 * covers the majority of agent renderers without per-adapter selectors.
 *
 * ## Font fallback chain
 *
 * When `fontFamily` is specified, the injector appends a standard monospace
 * fallback chain for code elements: `Operator Mono` → `VictorMono` →
 * `JetBrainsMono` → `Fira Code` → `SF Mono` → `Menlo` → `Monaco` →
 * `Consolas` → `monospace`.
 */

/** Default font fallback chain for code elements. */
export const MONOSPACE_FONT_CHAIN =
  'Operator Mono, VictorMono, JetBrainsMono, Fira Code, SF Mono, Menlo, Monaco, Consolas, monospace';

/**
 * Runtime Markdown style configuration.
 *
 * All fields are optional — only specified fields are injected. This lets
 * users customize a single aspect (e.g. only heading colors) without
 * overriding the agent's native styling for other elements.
 */
export interface MarkdownStyles {
  /** Base heading color (applied to h1–h6 unless overridden per-level). */
  headingColor?: string;
  /** H1 specific heading color (overrides `headingColor` for h1). */
  headingColorH1?: string;
  /** H2 specific heading color (overrides `headingColor` for h2). */
  headingColorH2?: string;
  /** H3 specific heading color (overrides `headingColor` for h3). */
  headingColorH3?: string;
  /** Link color for anchor elements in Markdown content. */
  linkColor?: string;
  /** Background color for code blocks (`pre`, `pre > code`). */
  codeBackground?: string;
  /** Text color for code blocks (`pre`, `pre > code`). */
  codeColor?: string;
  /** Color for inline code elements (`code` not inside `pre`). */
  inlineCodeColor?: string;
  /** Text color for blockquote elements. */
  blockquoteColor?: string;
  /** Font family applied to the Markdown content container. */
  fontFamily?: string;
}

/**
 * Result of a Markdown style injection operation.
 */
export interface MarkdownInjectResult {
  /** Whether the injection was successful. */
  success: boolean;
  /** Number of CSS rules injected (0 if failed). */
  ruleCount: number;
  /** Error message if injection failed. */
  error?: string;
}

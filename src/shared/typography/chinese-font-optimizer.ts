// SPDX-License-Identifier: MPL-2.0

/**
 * # Chinese Font Optimizer — 中文字体渲染优化
 *
 * Provides platform-aware Chinese font stacks, optimized line heights for
 * CJK text, and Chinese text detection. Designed to complement the existing
 * 14-token contract without modifying it — all typography tokens are
 * additive extensions.
 *
 * ## Platform Coverage
 *
 * | Platform | Primary Chinese Fallback |
 * |----------|--------------------------|
 * | macOS    | PingFang SC              |
 * | Windows  | Microsoft YaHei          |
 * | Linux    | Noto Sans CJK SC         |
 *
 * ## Design Decisions
 *
 * - Chinese line height is set higher than Latin (1.6–1.8 vs 1.2–1.5) because
 *   CJK characters have no ascender/descender breathing room and require
 *   more inter-line spacing for readability.
 * - Font weights are kept at 400 (regular) for body text and 500–600 for
 *   headings, matching the conventions of major Chinese UI systems
 *   (Apple HIG, Microsoft Fluent, Ant Design).
 *
 * Pure module — no DOM or Electron deps. Can be imported by both the
 * main process and the engine runtime.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported platform identifiers. */
export type Platform = 'macos' | 'windows' | 'linux';

/** Context in which Chinese text appears — affects weight and line height. */
export type ChineseTextContext = 'body' | 'heading' | 'code' | 'ui';

/**
 * A font stack entry with family name and optional platform tag.
 */
export interface FontStackEntry {
  /** CSS font-family value (comma-separated fallbacks). */
  family: string;
  /** Platform this stack is primarily optimized for. */
  platform: Platform;
}

/**
 * Complete Chinese typography configuration for a given context.
 */
export interface ChineseTypographyConfig {
  /** CSS font-family value. */
  fontFamily: string;
  /** CSS font-weight value. */
  fontWeight: number;
  /** Unitless line-height value. */
  lineHeight: number;
  /** CSS letter-spacing value. */
  letterSpacing: string;
}

// ---------------------------------------------------------------------------
// Font stack definitions
// ---------------------------------------------------------------------------

/**
 * macOS Chinese font stack — PingFang SC is the system Chinese font since
 * OS X Yosemite (10.11). Hiragino Sans GB is included as a legacy fallback
 * for older macOS versions.
 */
export const MACOS_CHINESE_STACK: readonly string[] = [
  'PingFang SC',
  'Hiragino Sans SC',
  'Hiragino Sans GB',
  'Heiti SC',
  'STHeiti',
];

/**
 * Windows Chinese font stack — Microsoft YaHei is the default Chinese font
 * since Windows Vista. SimSun (中易宋体) is the legacy fallback.
 */
export const WINDOWS_CHINESE_STACK: readonly string[] = [
  'Microsoft YaHei',
  'Microsoft YaHei UI',
  'SimSun',
  'SimHei',
  'NSimSun',
];

/**
 * Linux Chinese font stack — Noto Sans CJK SC is the most widely available
 * CJK font on Linux distributions. WenQuanYi Micro Hei is a common alternative.
 */
export const LINUX_CHINESE_STACK: readonly string[] = [
  'Noto Sans CJK SC',
  'Noto Sans SC',
  'WenQuanYi Micro Hei',
  'WenQuanYi Zen Hei',
  'Droid Sans Fallback',
];

/**
 * Universal Latin font stack that precedes Chinese fonts. Inter is the
 * project's primary UI font (per design-tokens.md §3).
 */
export const LATIN_UI_STACK: readonly string[] = ['Inter', '-apple-system', 'BlinkMacSystemFont'];

/**
 * Generic sans-serif fallback appended to every stack.
 */
export const GENERIC_SANS_FALLBACK = 'sans-serif';

// ---------------------------------------------------------------------------
// Font stack generation
// ---------------------------------------------------------------------------

/**
 * Generate a platform-aware Chinese font stack string suitable for use as a
 * CSS `font-family` value.
 *
 * The stack is ordered: Latin UI fonts → platform-specific Chinese fonts →
 * generic fallback. This ensures Latin text renders in Inter while Chinese
 * characters fall back to the platform-optimized font.
 *
 * @param platform  Target platform (default: detected from `navigator.platform`
 *                  or `process.platform` in Node/Electron).
 * @param options   Optional overrides for the Latin stack and generic fallback.
 * @returns         A CSS `font-family` string.
 *
 * @example
 * ```ts
 * generateChineseFontStack('macos');
 * // → "Inter, -apple-system, BlinkMacSystemFont, PingFang SC, Hiragino Sans SC, Hiragino Sans GB, Heiti SC, STHeiti, sans-serif"
 * ```
 */
export function generateChineseFontStack(
  platform: Platform = detectPlatform(),
  options?: {
    /** Override the Latin UI font stack. */
    latinStack?: readonly string[];
    /** Override the generic fallback. */
    genericFallback?: string;
  },
): string {
  const latin = options?.latinStack ?? LATIN_UI_STACK;
  const fallback = options?.genericFallback ?? GENERIC_SANS_FALLBACK;

  const chineseStack = getChineseStackForPlatform(platform);
  return [...latin, ...chineseStack, fallback].join(', ');
}

/**
 * Get the Chinese font stack for a specific platform.
 *
 * @param platform  Target platform.
 * @returns         Array of font family names.
 */
export function getChineseStackForPlatform(platform: Platform): readonly string[] {
  switch (platform) {
    case 'macos':
      return MACOS_CHINESE_STACK;
    case 'windows':
      return WINDOWS_CHINESE_STACK;
    case 'linux':
      return LINUX_CHINESE_STACK;
  }
}

/**
 * Detect the current platform. In a browser/Electron renderer context this
 * uses `navigator.platform`; in Node/Electron main it uses `process.platform`.
 *
 * @returns The detected platform, defaulting to 'windows' if unknown.
 */
export function detectPlatform(): Platform {
  // Check for browser/Electron renderer context.
  if (typeof navigator !== 'undefined' && navigator.platform) {
    const p = navigator.platform.toLowerCase();
    if (p.includes('mac')) return 'macos';
    if (p.includes('win')) return 'windows';
    if (p.includes('linux')) return 'linux';
  }

  // Check for Node/Electron main context.
  if (typeof process !== 'undefined' && process.platform) {
    const p = process.platform;
    if (p === 'darwin') return 'macos';
    if (p === 'win32') return 'windows';
    if (p === 'linux') return 'linux';
  }

  // Default to windows (largest user base for Chinese desktop apps).
  return 'windows';
}

// ---------------------------------------------------------------------------
// Line height optimization
// ---------------------------------------------------------------------------

/**
 * Base line heights per context. Chinese text requires higher line heights
 * than Latin due to the uniform bounding box of CJK characters.
 *
 * Reference values:
 * - Body text: 1.75 (Apple HIG recommends 1.6–1.8 for Chinese)
 * - Headings: 1.6 (tighter for visual hierarchy)
 * - Code: 1.7 (monospace CJK needs breathing room)
 * - UI elements: 1.6 (compact but readable)
 */
const CONTEXT_LINE_HEIGHTS: Record<ChineseTextContext, number> = {
  body: 1.75,
  heading: 1.6,
  code: 1.7,
  ui: 1.6,
};

/**
 * Get the optimized line height for Chinese text in a given context.
 *
 * @param context  The text context (body / heading / code / ui).
 * @returns        Unitless line-height value.
 *
 * @example
 * ```ts
 * getOptimizedLineHeight('body');    // → 1.75
 * getOptimizedLineHeight('heading'); // → 1.6
 * ```
 */
export function getOptimizedLineHeight(context: ChineseTextContext = 'body'): number {
  return CONTEXT_LINE_HEIGHTS[context];
}

/**
 * Get the optimized font weight for Chinese text in a given context.
 *
 * Chinese fonts typically render heavier than Latin at the same weight,
 * so we use slightly lower weights for body text.
 *
 * @param context  The text context.
 * @returns        CSS font-weight value.
 */
export function getOptimizedFontWeight(context: ChineseTextContext = 'body'): number {
  switch (context) {
    case 'body':
      return 400;
    case 'heading':
      return 500;
    case 'code':
      return 400;
    case 'ui':
      return 400;
  }
}

/**
 * Get the complete Chinese typography configuration for a given context
 * and platform.
 *
 * @param context   The text context.
 * @param platform  Target platform (default: auto-detected).
 * @returns         A full typography config object.
 */
export function getChineseTypography(
  context: ChineseTextContext = 'body',
  platform: Platform = detectPlatform(),
): ChineseTypographyConfig {
  return {
    fontFamily: generateChineseFontStack(platform),
    fontWeight: getOptimizedFontWeight(context),
    lineHeight: getOptimizedLineHeight(context),
    letterSpacing: context === 'code' ? '0' : '0.01em',
  };
}

// ---------------------------------------------------------------------------
// Chinese text detection
// ---------------------------------------------------------------------------

/**
 * Unicode ranges for CJK (Chinese, Japanese, Korean) characters.
 *
 * Covers:
 * - CJK Unified Ideographs (U+4E00–U+9FFF) — common Chinese characters
 * - CJK Unified Ideographs Extension A (U+3400–U+4DBF) — rare characters
 * - CJK Compatibility Ideographs (U+F900–U+FAFF) — compatibility variants
 * - CJK Symbols and Punctuation (U+3000–U+303F) — full-width punctuation
 * - Fullwidth Forms (U+FF00–U+FFEF) — full-width ASCII variants
 */
const CJK_REGEX = /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF\u3000-\u303F\uFF00-\uFFEF]/;

/**
 * Detect whether a string contains Chinese (CJK) characters.
 *
 * Returns true if any character in the input falls within the CJK Unified
 * Ideographs range or related CJK Unicode blocks.
 *
 * @param text  The string to test.
 * @returns     True if the string contains at least one CJK character.
 *
 * @example
 * ```ts
 * isChineseText('Hello');           // → false
 * isChineseText('你好');             // → true
 * isChineseText('Hello 你好');       // → true
 * isChineseText('');                 // → false
 * ```
 */
export function isChineseText(text: string): boolean {
  if (!text) return false;
  return CJK_REGEX.test(text);
}

/**
 * Calculate the ratio of CJK characters in a string.
 *
 * Useful for determining whether to apply Chinese typography overrides
 * to a mixed-language element.
 *
 * @param text  The string to analyze.
 * @returns     Ratio of CJK characters to total length (0.0–1.0).
 */
export function chineseTextRatio(text: string): number {
  if (!text) return 0;
  let count = 0;
  for (const char of text) {
    if (CJK_REGEX.test(char)) count++;
  }
  return count / text.length;
}

/**
 * Determine whether Chinese typography should be applied based on the
 * ratio of CJK characters in the text.
 *
 * When the ratio exceeds the threshold, Chinese-optimized font and line
 * height should be used.
 *
 * @param text       The string to evaluate.
 * @param threshold  Minimum CJK ratio to trigger Chinese typography (default: 0.3).
 * @returns          True if Chinese typography should be applied.
 */
export function shouldApplyChineseTypography(text: string, threshold = 0.3): boolean {
  return chineseTextRatio(text) >= threshold;
}

// ---------------------------------------------------------------------------
// CSS variable generation
// ---------------------------------------------------------------------------

/**
 * Generate CSS custom properties for Chinese typography as a `:root {}` block.
 *
 * These variables extend the 14-token contract without modifying it.
 * Themes can reference these variables in their CSS targets.
 *
 * @param platform  Target platform.
 * @param context   Text context.
 * @returns         A CSS string with `:root { ... }` rules.
 */
export function generateChineseTypographyCSS(
  platform: Platform = detectPlatform(),
  context: ChineseTextContext = 'body',
): string {
  const config = getChineseTypography(context, platform);
  return `:root {
  --agentskin-zh-font-family: ${config.fontFamily};
  --agentskin-zh-font-weight: ${config.fontWeight};
  --agentskin-zh-line-height: ${config.lineHeight};
  --agentskin-zh-letter-spacing: ${config.letterSpacing};
}`.trim();
}

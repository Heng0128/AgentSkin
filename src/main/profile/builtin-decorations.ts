// SPDX-License-Identifier: MPL-2.0

/**
 * # Builtin Decorations
 *
 * A set of lightweight, CSS/SVG-described decorative shapes that serve as the
 * **no-AI fallback** for the decoration generator. Because they are pure
 * string templates (no binary image assets), they:
 *
 *   - Work fully offline with zero external API dependency.
 *   - Are parameterised by a single accent colour derived from the source
 *     image so they visually harmonise with the theme.
 *   - Are serialised to `data:image/svg+xml;base64,…` data URLs for storage
 *     alongside the theme.
 *
 * ## Shape catalogue (6 builtins — purposely a small, curated set)
 *
 *   | id        | name        | Visual                              |
 *   |-----------|-------------|-------------------------------------|
 *   | heart     | Heart       | Rounded heart outline               |
 *   | star      | Star        | 5-point star                        |
 *   | snowflake  | Snowflake   | 6-arm stylised snowflake            |
 *   | flower    | Flower      | Simple daisy (petals + center)      |
 *   | bubble    | Bubble      | Circle with highlight               |
 *   | leaf      | Leaf        | Leaf with vein                      |
 *
 * ## Extending
 *
 * To add a new builtin: add a new entry to {@link BUILTIN_DECORATIONS} with
 * a unique `id`, a human-readable `name`, and a pure `render(accent)` function
 * returning a self-contained SVG string (`viewBox="0 0 128 128"`).
 */

/**
 * A builtin decoration template. The `render` function is pure — given an
 * accent colour hex string it returns a standalone SVG document string.
 *
 * The SVG always uses `viewBox="0 0 128 128"` so all builtins share the same
 * intrinsic coordinate system (consistent `width`/`height` in the asset).
 */
export interface BuiltinDecorationTemplate {
  id: string;
  name: string;
  /**
   * Render the decoration as an SVG string.
   * @param accent  Accent colour as `#rrggbb` hex.
   * @returns       Complete SVG document string.
   */
  render: (accent: string) => string;
}

/** Wrap path data into a full 128×128 SVG document. */
function svgDoc(inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">${inner}</svg>`;
}

// ---------------------------------------------------------------------------
// Shape renderers (pure)
// ---------------------------------------------------------------------------

function renderHeart(accent: string): string {
  return svgDoc(
    `<path d="M64 112S8 80 8 48a24 24 0 0 1 44-12l8 12 8-12A24 24 0 0 1 120 48c0 32-56 64-56 64z" fill="none" stroke="${accent}" stroke-width="6" stroke-linejoin="round"/>`,
  );
}

function renderStar(accent: string): string {
  return svgDoc(
    `<polygon points="64,8 78,48 120,48 86,72 98,112 64,88 30,112 42,72 8,48 50,48" fill="none" stroke="${accent}" stroke-width="6" stroke-linejoin="round"/>`,
  );
}

function renderSnowflake(accent: string): string {
  return svgDoc(
    `<g fill="none" stroke="${accent}" stroke-width="5" stroke-linecap="round">
      <line x1="64" y1="16" x2="64" y2="112"/>
      <line x1="20" y1="40" x2="108" y2="88"/>
      <line x1="20" y1="88" x2="108" y2="40"/>
      <line x1="64" y1="32" x2="52" y2="20"/>
      <line x1="64" y1="32" x2="76" y2="20"/>
      <line x1="64" y1="96" x2="52" y2="108"/>
      <line x1="64" y1="96" x2="76" y2="108"/>
      <line x1="28" y1="52" x2="16" y2="44"/>
      <line x1="28" y1="52" x2="16" y2="60"/>
      <line x1="100" y1="52" x2="112" y2="44"/>
      <line x1="100" y1="52" x2="112" y2="60"/>
      <line x1="28" y1="76" x2="16" y2="84"/>
      <line x1="28" y1="76" x2="16" y2="68"/>
      <line x1="100" y1="76" x2="112" y2="84"/>
      <line x1="100" y1="76" x2="112" y2="68"/>
    </g>`,
  );
}

function renderFlower(accent: string): string {
  return svgDoc(
    `<g fill="none" stroke="${accent}" stroke-width="5" stroke-linecap="round">
      <ellipse cx="64" cy="36" rx="14" ry="22"/>
      <ellipse cx="64" cy="92" rx="14" ry="22"/>
      <ellipse cx="36" cy="64" rx="22" ry="14"/>
      <ellipse cx="92" cy="64" rx="22" ry="14"/>
      <ellipse cx="44" cy="44" rx="18" ry="12" transform="rotate(-45 44 44)"/>
      <ellipse cx="84" cy="84" rx="18" ry="12" transform="rotate(-45 84 84)"/>
      <ellipse cx="44" cy="84" rx="18" ry="12" transform="rotate(45 44 84)"/>
      <ellipse cx="84" cy="44" rx="18" ry="12" transform="rotate(45 84 44)"/>
      <circle cx="64" cy="64" r="10" fill="${accent}" stroke="none"/>
    </g>`,
  );
}

function renderBubble(accent: string): string {
  return svgDoc(
    `<circle cx="64" cy="64" r="44" fill="none" stroke="${accent}" stroke-width="6"/>
     <ellipse cx="48" cy="48" rx="14" ry="10" fill="none" stroke="${accent}" stroke-width="4" opacity="0.6"/>`,
  );
}

function renderLeaf(accent: string): string {
  return svgDoc(
    `<g fill="none" stroke="${accent}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round">
      <path d="M24 100 C24 40 72 20 104 24 C104 64 88 96 24 100 Z"/>
      <line x1="32" y1="92" x2="96" y2="32"/>
    </g>`,
  );
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** Ordered list of all builtin decoration templates. */
export const BUILTIN_DECORATIONS: readonly BuiltinDecorationTemplate[] = [
  { id: 'heart', name: 'Heart', render: renderHeart },
  { id: 'star', name: 'Star', render: renderStar },
  { id: 'snowflake', name: 'Snowflake', render: renderSnowflake },
  { id: 'flower', name: 'Flower', render: renderFlower },
  { id: 'bubble', name: 'Bubble', render: renderBubble },
  { id: 'leaf', name: 'Leaf', render: renderLeaf },
] as const;

/** Resolution of all builtins (shared coordinate system). */
export const BUILTIN_DIMENSION = 128;

/** Look up a builtin template by id. Returns undefined when not found. */
export function getBuiltinDecoration(id: string): BuiltinDecorationTemplate | undefined {
  return BUILTIN_DECORATIONS.find((b) => b.id === id);
}

/**
 * Render a builtin decoration to a base64 data URL.
 *
 * @param id     Builtin decoration id (e.g. `'heart'`).
 * @param accent Accent colour as `#rrggbb`.
 * @returns      A `data:image/svg+xml;base64,…` string, or `null` when the
 *               id is unknown.
 */
export function renderBuiltinToDataUrl(id: string, accent: string): string | null {
  const template = getBuiltinDecoration(id);
  if (!template) return null;
  const svg = template.render(accent);
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

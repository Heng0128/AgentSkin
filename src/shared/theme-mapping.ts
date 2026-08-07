// SPDX-License-Identifier: MPL-2.0

/**
 * # theme-mapping
 *
 * Shared conversion between the manifest's semantic color names
 * (`colors.background`, `colors.accent`, …) and the `--agentskin-*` design
 * tokens used by the Studio editor palette and the per-agent CSS.
 *
 * Lives in `shared/` because both the main process (Studio project import in
 * `studio-project-ipc.ts`) and the renderer (Theme Studio's "load installed
 * theme" flow) need the same mapping — duplicating it would let the two
 * directions drift.
 */

/** Manifest semantic color name → `--agentskin-*` token. */
export const SEMANTIC_TO_AGENTSKIN: Record<string, string> = {
  background: '--agentskin-bg',
  foreground: '--agentskin-text',
  accent: '--agentskin-accent',
  secondary: '--agentskin-secondary',
  surface: '--agentskin-surface',
  surfaceElevated: '--agentskin-surface-elevated',
  muted: '--agentskin-muted',
  border: '--agentskin-border',
  codeBackground: '--agentskin-code-bg',
  codeForeground: '--agentskin-code-fg',
  inputBackground: '--agentskin-input-bg',
  buttonBackground: '--agentskin-button-bg',
  buttonForeground: '--agentskin-button-fg',
  focusRing: '--agentskin-focus-ring',
};

/**
 * Convert a manifest `colors` object (semantic names) into a
 * `--agentskin-*` palette dictionary (Studio palette format). Only keys with
 * a known mapping and a string value are carried through.
 */
export function semanticColorsToPalette(colors?: Record<string, unknown>): Record<string, string> {
  const palette: Record<string, string> = {};
  if (!colors) return palette;
  for (const [semantic, value] of Object.entries(colors)) {
    const token = SEMANTIC_TO_AGENTSKIN[semantic];
    if (token && typeof value === 'string') palette[token] = value;
  }
  return palette;
}

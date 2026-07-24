// SPDX-License-Identifier: MPL-2.0

/**
 * # Theme Bundle Contract
 *
 * First-class interface declarations for the theme package shape consumed by
 * the orchestrator (`AgentEngineService`), the catalog layer
 * (`ThemeLibrary`, `ThemePackageLoader`), the CDP injection modules
 * (`cdp-inject`, `cdp-fanout`, `palette-builder`), and the IPC layer.
 *
 * ## Why a dedicated contract file?
 *
 * Before this module, `ThemeBundle` was a bare type alias
 * (`type ThemeBundle = ThemePackage`) buried inside
 * `legacy/agentskin-core-runtime.ts`. Consumers imported it from the legacy
 * runtime, which conflated two concerns:
 *   1. The structural contract *every* main-process module depends on.
 *   2. The legacy runtime functions (`readTheme`, `validateTheme`,
 *      `applyTheme`, ...) that bridge into `@agentskin/core`.
 *
 * Lifting the structural types into this file makes the contract explicit,
 * documented, and owned by the services layer — independent of where the
 * runtime implementation happens to live. The engine's `ThemePackage` (and
 * its sub-types) is structurally assignable to these interfaces, so the
 * existing `readThemePackage` / `validateThemePackage` call sites keep
 * working unchanged.
 *
 * ## Boundary
 *
 * These interfaces live under `main/services/` (not `shared/`) because they
 * describe a main-process-only contract. The renderer never imports them —
 * it receives already-flattened `InstalledTheme` summaries via IPC.
 */

/**
 * Identity metadata shared by every theme package (modern and legacy).
 * Mirrors `@agentskin/core`'s `ThemeIdentity` 1:1 so the engine's parsed
 * bundles are structurally assignable.
 */
export interface ThemeIdentity {
  id: string;
  displayName: string;
  version: string;
  /** Free-form copy overrides (UI strings, art toggles, etc.). */
  copy?: Record<string, unknown>;
  /** Store-facing metadata; marketplaces prefill listings from it. */
  catalog?: {
    name?: { en?: string; zh?: string };
    description?: string | { en?: string; zh?: string };
  };
}

/**
 * A base64-encoded image asset embedded in a theme package.
 * Mirrors `@agentskin/core`'s `ThemeImage`.
 */
export interface ThemeImage {
  filename: string;
  mimeType: string;
  base64: string;
}

/**
 * @deprecated Use `ThemeImage` directly. Kept as a named alias so existing
 * call sites (`bundle.assets?.art`) keep type-checking.
 */
export interface ThemeArt extends ThemeImage {}

/**
 * Per-agent target: the CSS file to inject plus optional renderer/base-theme
 * options and a verification profile. The keys of `ThemeBundle.targets` are
 * agent ids (`AgentId`); legacy packages may also include non-agent keys,
 * which `ThemeLibrary.legacyTargets()` filters out.
 */
export interface ThemeTarget {
  css: string;
  options?: Record<string, unknown> & {
    rendererProfile?: string;
    baseTheme?: Record<string, unknown>;
  };
  verification?: VerificationProfile;
}

/**
 * A single DOM assertion (selector present, CSS variable set, etc.) that
 * the engine runs after injection to confirm the theme took effect.
 * Mirrors `@agentskin/core`'s `VerificationRequirement`.
 */
export interface VerificationRequirement {
  name: string;
  any: string[];
}

/**
 * A named verification context that only applies when its `when.any`
 * selectors match something on the page. Mirrors `@agentskin/core`'s
 * `VerificationContext`.
 */
export interface VerificationContext {
  name: string;
  when: { any: string[] };
  required?: VerificationRequirement[];
  recommended?: VerificationRequirement[];
}

/**
 * Verification profile for a theme target — drives the post-inject DOM
 * assertion that confirms the theme actually took effect (selector present,
 * CSS variable set, etc.). Mirrors `@agentskin/core`'s
 * `VerificationProfile` 1:1 so the engine's parsed profiles are structurally
 * assignable to this contract.
 */
export interface VerificationProfile {
  rootAny?: string[];
  required?: VerificationRequirement[];
  recommended?: VerificationRequirement[];
  contexts?: VerificationContext[];
}

/**
 * A parsed theme package — the canonical bundle shape that flows from
 * `readThemePackage()` / `validateThemePackage()` through the catalog layer
 * into the orchestrator's `apply()` / `restore()` flows.
 *
 * Structurally identical to `@agentskin/core`'s `ThemePackage`. The engine's
 * parsed bundles are assignable to this interface without any adapter.
 */
export interface ThemeBundle {
  format: 'codedrobe-theme';
  schemaVersion: 1;
  exportedAt?: string;
  theme: ThemeIdentity;
  targets: Record<string, ThemeTarget>;
  assets?: {
    images?: Record<string, ThemeImage>;
    /** @deprecated Use images.hero for new theme packages. */
    art?: ThemeArt;
  };
}

/**
 * A resolved theme target ready for CDP injection — produced by
 * `resolveThemeTargetFor(bundle, appId)` after looking up the agent's
 * `ThemeTarget`, dereferencing its image assets into data URLs, and falling
 * back to the theme's `art` field for backward compatibility.
 */
export interface ResolvedThemeTarget {
  theme: ThemeIdentity;
  css: string;
  options: Record<string, unknown>;
  verification: VerificationProfile | null;
  imageDataUrls: Record<string, string>;
  /** Backward-compatible alias for `imageDataUrls.hero`. */
  artDataUrl: string | null;
}

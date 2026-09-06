// SPDX-License-Identifier: MPL-2.0

/**
 * # WindowMatcher — CDP target URL/title pattern matching for multi-window injection.
 *
 * Abstracts the "does this CDP target belong to a known application window?" question
 * behind a single interface so that:
 *
 *   1. Each adapter can declare its window-hint list declaratively.
 *   2. The `window-watcher` can match newly-created CDP targets against every
 *      registered adapter and trigger auto-injection when a match is found.
 *   3. Pattern matching is a pure function (`matchWindow`) — unit-testable without
 *      CDP, Electron, or a running agent.
 *
 * A `WindowMatcher` is a set of rules evaluated against a CDP target's `url` and
 * `title`. A target matches when **any** of the patterns match (OR semantics).
 * Patterns are tried against `url` first, then `title` — url match short-circuits.
 *
 * ## Role taxonomy
 *
 * The `WindowRole` enum classifies matched targets so downstream consumers
 * (watcher, watchdog, hardening pass) can decide *what* to inject:
 *
 *   - `main`      — the primary application window. Receives the full engine
 *                   palette→tokens→cosmetic→theme + adapter.mjs pipeline.
 *   - `popup`     — detached pop-out panels (TRAE Work's floating chat window,
 *                   Doubao's mini-window). Same full pipeline as `main` but
 *                   typically rendered at smaller size; CSS adapts via media query.
 *   - `settings`  — preferences/options windows. Usually inherit palette+tokens
 *                   but NOT the heavy cosmetic/hero layer (no chat DOM to theme).
 *   - `secondary` — auxiliary pages that should be identified but NOT injected
 *                   (Codex avatar-overlay, Doubao's background service page).
 *                   The watcher skips these so they don't steal focus from the
 *                   main renderer.
 *
 * ## Usage
 *
 *   // In an adapter:
 *   override readonly windowHints: WindowMatcher[] = [
 *     { role: 'main', patterns: ['/solo-lite.', 'solo-lite|trae'] },
 *     { role: 'popup', patterns: ['/popout', 'popout'] },
 *   ];
 *
 *   // In the watcher:
 *   const match = matchWindow(adapter.windowHints, cdpTarget);
 *   if (match && match.role !== 'secondary') { injectTarget(cdpTarget); }
 */

/** The set of known window roles an adapter can declare. */
export enum WindowRole {
  /** Primary application window — full engine injection. */
  Main = 'main',
  /** Detached pop-out panel — full engine injection (smaller viewport). */
  Popup = 'popup',
  /** Preferences / settings window — palette + tokens only (no hero/cosmetic). */
  Settings = 'settings',
  /** Auxiliary page — identified but NOT injected (background, overlay, etc.). */
  Secondary = 'secondary',
}

/**
 * A single matcher rule: a role plus one or more URL/title patterns.
 *
 * All fields are optional at the type level for forward compatibility, but
 * production code should always provide `role` and at least one pattern.
 */
export interface WindowMatcher {
  /** The role assigned to targets matching this matcher. */
  role: WindowRole;
  /**
   * URL or title patterns (OR semantics — first match wins). Each pattern is
   * a case-insensitive string that is matched as a substring against the
   * target's `url` first, then `title`. Empty / whitespace-only patterns are
   * skipped (they would match everything and defeat the matcher).
   */
  patterns: string[];
  /**
   * Optional human-readable name for diagnostics (e.g. "TRAE Work main",
   * "Codex avatar-overlay"). Used in log lines so operators can tell which
   * matcher fired for a given target.
   */
  label?: string;
}

/** Minimal CDP target shape needed for window matching. */
export interface WindowMatchTarget {
  /** Target URL (e.g. `app://codex/index.html`, `file:///.../solo-lite.html`). */
  url?: string;
  /** Target title (window title bar text). */
  title?: string;
}

/** Result of a successful window match. */
export interface WindowMatchResult {
  /** The matcher rule that matched (role + patterns + optional label). */
  matcher: WindowMatcher;
  /** The specific pattern that matched (useful for diagnostics). */
  matchedPattern: string;
  /** Whether the match was against the URL (true) or title (false). */
  matchedViaUrl: boolean;
}

/**
 * Try to match a CDP target against a list of window matchers.
 *
 * Pure function — no side effects, no I/O. Safe to call from unit tests.
 *
 * Algorithm:
 *   1. Iterate matchers in declaration order (first-match-wins).
 *   2. For each matcher, iterate patterns in declaration order.
 *   3. Try `url` first (substring, case-insensitive), then `title`.
 *   4. Return the first matcher+pattern combination that matches.
 *
 * Returns `null` when no matcher matches (target is unknown / not skinnable).
 *
 * @param matchers  The adapter's window-hint list (empty → never matches).
 * @param target    The CDP target to match (needs `url` and/or `title`).
 */
export function matchWindow(
  matchers: readonly WindowMatcher[] | undefined,
  target: WindowMatchTarget,
): WindowMatchResult | null {
  if (!matchers || matchers.length === 0) return null;

  const url = String(target.url ?? '').toLowerCase();
  const title = String(target.title ?? '').toLowerCase();

  for (const matcher of matchers) {
    for (const rawPattern of matcher.patterns) {
      const pattern = rawPattern.trim();
      if (!pattern) continue;
      const lc = pattern.toLowerCase();

      // URL first
      if (url.includes(lc)) {
        return { matcher, matchedPattern: pattern, matchedViaUrl: true };
      }
      // Title fallback
      if (title.includes(lc)) {
        return { matcher, matchedPattern: pattern, matchedViaUrl: false };
      }
    }
  }

  return null;
}

/**
 * Filter a list of matchers by role. Useful when the watcher needs "all
 * non-secondary matchers" to decide what to auto-inject.
 */
export function matchersByRole(
  matchers: readonly WindowMatcher[] | undefined,
  role: WindowRole,
): WindowMatcher[] {
  if (!matchers) return [];
  return matchers.filter((m) => m.role === role);
}

/**
 * Returns true when the given target matches a `Secondary` matcher. The
 * watcher uses this to skip auto-injection for background/overlay pages
 * that must not be themed.
 */
export function isSecondaryWindow(
  matchers: readonly WindowMatcher[] | undefined,
  target: WindowMatchTarget,
): boolean {
  const result = matchWindow(matchers, target);
  return result?.matcher.role === WindowRole.Secondary;
}

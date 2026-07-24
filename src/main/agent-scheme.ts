// SPDX-License-Identifier: MPL-2.0

/**
 * # agent-scheme
 *
 * Best-effort light/dark scheme synchronisation. The theme engine
 * (@agentskin/core) only injects/removes CSS; it never touches an agent's
 * own internal light/dark mode. Many themes only look right when the host
 * agent is in the matching mode, and users previously had to flip dark mode
 * by hand inside every agent. This module closes that gap: after a theme is
 * applied it flips each agent's internal scheme (via CDP) to match the
 * theme's declared `mode`, and restores the user's original choice when the
 * theme is removed.
 *
 * Two complementary mechanisms are used:
 *
 * 1. **CDP `Emulation.setEmulatedMedia`** — sets `prefers-color-scheme` at
 *    the browser level. This is the most reliable mechanism because it
 *    affects all `@media (prefers-color-scheme)` CSS queries, the
 *    `color-scheme` property, and native form controls / scrollbars. Works
 *    even when the app's own JS ignores DOM attribute changes or CSS
 *    variable overrides. Applied to ALL agents (including workbuddy).
 *
 * 2. **DOM / localStorage manipulation** — flips `data-theme` attributes,
 *    body classes, and localStorage keys so the app's own JS theme system
 *    picks up the new mode and re-renders. Per-agent mechanics:
 *   - qoderwork: root `data-theme` attribute + `theme` /
 *     `preferences:theme-brightness` localStorage. The attribute value keeps
 *     a colour variant across the flip (e.g. `light-parchment`→`dark-parchment`,
 *     `classic-light`→`classic-dark`).
 *   - traework:  root `data-theme` attribute + body `dark|light`/`vs-*`
 *     classes + `trae-foundation-theme` localStorage (stored by the app as a
 *     JSON string `{"value":"dark"}`).
 *   - workbuddy: no renderer scheme to flip (main-process driven); relies on
 *     CDP media emulation alone.
 *
 * The user's pre-AgentSkin scheme is captured once (before the first switch)
 * and persisted to manager-state.json so it can be put back on restore.
 */

import type { CdpSession } from './cdp-client';
import type { AgentId } from '../shared/types';

/** A concrete light/dark choice ('auto' is resolved by the caller). */
export type SchemeMode = 'light' | 'dark';

/** Snapshot of an agent's scheme state taken before AgentSkin switches it. */
export interface SchemeSnapshot {
  agentId: AgentId;
  /** Root `data-theme` attribute value, or null when absent. */
  dataTheme: string | null;
  /** Captured localStorage values (null = key was absent). */
  storage: Record<string, string | null>;
}

interface SchemeStrategy {
  /** localStorage keys to capture (and restore). */
  storageKeys: string[];
  /** Whether the body carries `dark|light` + `vs-*` classes (traework). */
  syncBodyClasses: boolean;
  /** Compute the target `data-theme` value from the current one + mode. */
  targetDataTheme: (current: string | null, mode: SchemeMode) => string;
  /** localStorage writes that persist the mode in the app's own format. */
  storageWrites: (mode: SchemeMode, targetDataTheme: string) => Record<string, string>;
}

/**
 * Flip qoderwork's `data-theme` to the requested brightness while preserving
 * its colour variant. Handles both naming orders the app uses:
 * mode-first (`light-glass`, `dark-parchment`) and colour-first
 * (`classic-light`, `classic-dark`).
 */
function qoderworkTargetDataTheme(current: string | null, mode: SchemeMode): string {
  const cur = (current ?? '').trim();
  if (!cur || cur === 'light' || cur === 'dark') return mode;
  if (cur.startsWith('light-') || cur.startsWith('dark-')) {
    return `${mode}-${cur.slice(cur.indexOf('-') + 1)}`;
  }
  if (cur.endsWith('-light') || cur.endsWith('-dark')) {
    return `${cur.slice(0, cur.lastIndexOf('-'))}-${mode}`;
  }
  return mode;
}

const STRATEGIES: Partial<Record<AgentId, SchemeStrategy>> = {
  qoderwork: {
    storageKeys: ['theme', 'preferences:theme-brightness', 'preferences:theme-color'],
    syncBodyClasses: false,
    targetDataTheme: qoderworkTargetDataTheme,
    // `preferences:theme-color` (the variant) is deliberately left untouched.
    storageWrites: (mode, targetDataTheme) => ({
      theme: targetDataTheme,
      'preferences:theme-brightness': JSON.stringify(mode),
    }),
  },
  traework: {
    storageKeys: ['trae-foundation-theme'],
    syncBodyClasses: true,
    targetDataTheme: (_current, mode) => mode,
    // The app stores this key as a JSON string like {"value":"dark"}.
    storageWrites: (mode) => ({
      'trae-foundation-theme': JSON.stringify({ value: mode }),
    }),
  },
  // workbuddy: no renderer scheme to flip (main-process driven).
};

/**
 * Class + color-scheme toggle that flips the agent's light/dark mode on BOTH
 * `<html>` and `<body>`. Trae (VSCode-based) mirrors its mode on the root
 * element (`html.dark` / `html.vs-dark`), while some component trees also read
 * `body` classes — toggling both guarantees the `dark:` variant flips
 * regardless of which ancestor the app keys off. Setting `color-scheme`
 * reinforces native form controls / scrollbars.
 */
function modeClassLines(mode: SchemeMode): string {
  const add = mode === 'light' ? "'light', 'vs-light'" : "'dark', 'vs-dark'";
  const remove = mode === 'light' ? "'dark', 'vs-dark'" : "'light', 'vs-light'";
  return [
    `document.documentElement.classList.remove(${remove});`,
    `document.documentElement.classList.add(${add});`,
    `document.body.classList.remove(${remove});`,
    `document.body.classList.add(${add});`,
    `document.documentElement.style.colorScheme = ${JSON.stringify(mode)};`,
  ].join('\n      ');
}

/**
 * Dispatch synthetic `storage` events for every key we wrote, so agents that
 * subscribe to theme changes through `localStorage` (instead of pure CSS
 * `[data-theme]` selectors) re-read the new value and re-render live without
 * a reload. Wrapped in try/catch — purely a nudge, never fatal.
 */
function storageEventLines(writes: Record<string, string>): string {
  return Object.keys(writes)
    .map(
      (key) =>
        `try { window.dispatchEvent(new StorageEvent('storage', { key: ${JSON.stringify(key)}, newValue: ${JSON.stringify(writes[key])}, storageArea: localStorage })); } catch (e) {}`,
    )
    .join('\n      ');
}

// ---------------------------------------------------------------------------
// CDP media emulation (prefers-color-scheme)
// ---------------------------------------------------------------------------

/**
 * Emulate `prefers-color-scheme` at the CDP level so all CSS
 * `@media (prefers-color-scheme: dark|light)` queries, the `color-scheme`
 * property, and native form controls / scrollbars match the theme's mode.
 *
 * This is the most reliable scheme-switching mechanism because it operates
 * at the browser level — it works even when the app's own JS ignores DOM
 * attribute changes or CSS variable overrides. It is agent-agnostic: it
 * works for ALL agents including workbuddy (which has no renderer scheme).
 *
 * Best-effort: never throws. Returns true on success.
 */
export async function emulateColorScheme(
  session: CdpSession,
  mode: SchemeMode,
): Promise<boolean> {
  try {
    await session.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: mode }],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Clear the `prefers-color-scheme` emulation so the app reverts to its own
 * or the OS's preference. Called on theme restore.
 *
 * Best-effort: never throws.
 */
export async function clearColorSchemeEmulation(session: CdpSession): Promise<boolean> {
  try {
    await session.send('Emulation.setEmulatedMedia', {
      features: [],
    });
    return true;
  } catch {
    return false;
  }
}

/** Read the current `data-theme` + tracked localStorage keys in one call.
 *  Returns null on any CDP/eval failure (page navigating, renderer gone). */
async function readSchemeState(
  session: CdpSession,
  strategy: SchemeStrategy,
): Promise<{ dataTheme: string | null; storage: Record<string, string | null> } | null> {
  const storageExpr = strategy.storageKeys
    .map((key) => `${JSON.stringify(key)}: localStorage.getItem(${JSON.stringify(key)})`)
    .join(', ');
  const expression = `(() => {
    try {
      return JSON.stringify({
        dataTheme: document.documentElement.getAttribute('data-theme'),
        storage: { ${storageExpr} }
      });
    } catch { return null; }
  })()`;
  let raw: string;
  try {
    raw = await session.evaluate(expression);
  } catch {
    return null;
  }
  if (!raw || raw === 'null') return null;
  try {
    const parsed = JSON.parse(raw) as {
      dataTheme: string | null;
      storage: Record<string, string | null>;
    };
    return { dataTheme: parsed.dataTheme ?? null, storage: parsed.storage ?? {} };
  } catch {
    return null;
  }
}

/**
 * Capture the agent's current scheme state. Returns null for agents with no
 * renderer scheme (workbuddy) or when the page is unreachable.
 */
export async function captureScheme(
  session: CdpSession,
  agentId: AgentId,
): Promise<SchemeSnapshot | null> {
  const strategy = STRATEGIES[agentId];
  if (!strategy) return null;
  const state = await readSchemeState(session, strategy);
  if (!state) return null;
  return { agentId, dataTheme: state.dataTheme, storage: state.storage };
}

/**
 * Read back the effective scheme mode from the agent. Returns the mode if it
 * can be determined from `data-theme` or body classes, null otherwise.
 *
 * Used by `applyScheme` to verify the switch actually stuck — apps that
 * re-apply their own theme on render can silently overwrite our writes.
 */
async function readBackMode(
  session: CdpSession,
  agentId: AgentId,
): Promise<SchemeMode | null> {
  const strategy = STRATEGIES[agentId];
  if (!strategy) return null;
  const state = await readSchemeState(session, strategy);
  if (!state) return null;
  const dt = state.dataTheme ?? '';
  if (dt.includes('dark')) return 'dark';
  if (dt.includes('light')) return 'light';
  return null;
}

/**
 * Switch the agent's internal scheme to `mode`. Returns true when the switch
 * ran (or there was nothing to do, e.g. workbuddy); false on failure.
 * Best-effort: callers should treat false as non-fatal.
 *
 * Two layers are applied:
 * 1. CDP `Emulation.setEmulatedMedia` — forces `prefers-color-scheme` at the
 *    browser level (all agents, including workbuddy).
 * 2. DOM / localStorage manipulation — flips `data-theme` + body classes +
 *    localStorage so the app's own JS theme system re-renders (agents with
 *    a strategy only).
 *
 * After writing, the mode is read back and verified. If the app overwrote
 * our write (common during startup), we retry up to 3 times with a short
 * delay between attempts.
 */
export async function applyScheme(
  session: CdpSession,
  agentId: AgentId,
  mode: SchemeMode,
): Promise<boolean> {
  // Layer 1: CDP media emulation (all agents, including workbuddy).
  await emulateColorScheme(session, mode);

  const strategy = STRATEGIES[agentId];
  if (!strategy) return true; // No renderer scheme to flip — emulation alone.

  // Layer 2: DOM / localStorage manipulation with read-back verification.
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await readSchemeState(session, strategy);
    const target = strategy.targetDataTheme(current?.dataTheme ?? null, mode);
    const writes = strategy.storageWrites(mode, target);
    const writeLines = Object.entries(writes)
      .map(([key, value]) => `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)});`)
      .join('\n      ');
    const expression = `(() => {
      try {
        document.documentElement.setAttribute('data-theme', ${JSON.stringify(target)});
        ${strategy.syncBodyClasses ? `${modeClassLines(mode)}\n      ` : ''}${writeLines}
        ${storageEventLines(writes)}
        return 'ok';
      } catch { return 'err'; }
    })()`;
    let writeOk = false;
    try {
      writeOk = (await session.evaluate(expression)) === 'ok';
    } catch {
      writeOk = false;
    }
    if (!writeOk) {
      // JS injection failed — wait briefly and retry (app may be mid-render).
      if (attempt < 2) await sleep(400 * (attempt + 1));
      continue;
    }

    // Read back and verify the mode actually stuck.
    const readBack = await readBackMode(session, agentId);
    if (readBack === mode) return true;
    // Mode didn't stick (app overwrote it) — wait and retry.
    if (attempt < 2) await sleep(500 * (attempt + 1));
  }
  // Exhausted retries — CDP emulation (layer 1) is still active, so the
  // visual result is mostly correct even if the DOM attribute drifted.
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Put back a previously captured scheme snapshot. Returns true on success
 * (or when there is nothing to restore for this agent).
 *
 * Order: DOM restoration first, then clear CDP media emulation. This avoids
 * a brief flash where the app reverts to the OS scheme before the DOM state
 * is restored.
 */
export async function restoreScheme(
  session: CdpSession,
  snapshot: SchemeSnapshot,
): Promise<boolean> {
  const strategy = STRATEGIES[snapshot.agentId];

  // For agents with no DOM strategy (e.g. workbuddy), just clear the CDP
  // emulation — the app will revert to its own / OS preference.
  if (!strategy) {
    await clearColorSchemeEmulation(session);
    return true;
  }
  const { dataTheme } = snapshot;
  const attrLine = dataTheme == null
    ? "document.documentElement.removeAttribute('data-theme');"
    : `document.documentElement.setAttribute('data-theme', ${JSON.stringify(dataTheme)});`;
  const storageLines = Object.entries(snapshot.storage)
    .map(([key, value]) => (value == null
      ? `localStorage.removeItem(${JSON.stringify(key)});`
      : `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)});`))
    .join('\n      ');
  // Re-sync body classes to the restored mode for agents that need it.
  const restoredMode: SchemeMode | null = dataTheme == null
    ? null
    : dataTheme.includes('dark')
      ? 'dark'
      : dataTheme.includes('light')
        ? 'light'
        : null;
  const classLines = strategy.syncBodyClasses && restoredMode
    ? `${modeClassLines(restoredMode)}\n      `
    : '';
  const storageEventRestore = storageEventLines(
    Object.fromEntries(
      Object.entries(snapshot.storage).filter(([, v]) => v != null) as [string, string][],
    ),
  );
  const expression = `(() => {
    try {
      ${attrLine}
      ${classLines}${storageLines}
      ${storageEventRestore}
      return 'ok';
    } catch { return 'err'; }
  })()`;
  let domOk = false;
  try {
    domOk = (await session.evaluate(expression)) === 'ok';
  } catch {
    domOk = false;
  }

  // Clear the CDP prefers-color-scheme emulation AFTER the DOM state is
  // restored, so there is no flash where the app reverts to the OS scheme
  // before its own theme state is re-synced.
  await clearColorSchemeEmulation(session);

  return domOk;
}

/**
 * Resolve a theme's declared `mode` ('light' | 'dark' | 'auto') to a concrete
 * scheme. 'auto' maps to 'dark' to match the CSS generator, which renders
 * auto themes with a dark canvas — the agent's native chrome must follow the
 * injected CSS, not the OS preference. Returns null when the theme declares
 * no usable mode (scheme sync is then skipped).
 */
export function resolveSchemeMode(rawMode: unknown): SchemeMode | null {
  if (rawMode === 'light') return 'light';
  if (rawMode === 'dark') return 'dark';
  if (rawMode === 'auto') return 'dark';
  return null;
}

// SPDX-License-Identifier: MPL-2.0

/**
 * # import-guard
 *
 * Cross-store deduplication for theme imports.
 *
 * `installFlowStore.runImport` / `runImportFromPath` and
 * `themeStore.confirmFileImport` both call `api.importThemeFromPath(path)`.
 * Without a cross-path guard, a file-open event and a manual dialog click on
 * the same file can race, producing duplicate catalog entries, double
 * refreshThemes(), and double toasts.
 *
 * The Set is module-level so both stores share the same lock space. It is
 * updated synchronously (`importingPaths.has(path)` / `add(path)`) so a
 * duplicate call bails out before awaiting anything — no IPC, no refresh,
 * no toast.
 */

/** Paths currently being imported — shared across all importing stores. */
const importingPaths = new Set<string>();

/**
 * Run `fn` under a per-path lock.
 *
 * Returns `true` if `fn` was executed; `false` if the path was already
 * locked (callers should treat this as a silent no-op, not an error).
 */
export async function withImportLock(path: string, fn: () => Promise<void>): Promise<boolean> {
  if (importingPaths.has(path)) return false;
  importingPaths.add(path);
  try {
    await fn();
    return true;
  } finally {
    importingPaths.delete(path);
  }
}

/** Test / inspection helper — do not use in production paths. */
export function isImportingPath(path: string): boolean {
  return importingPaths.has(path);
}

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
 * The lock state is managed via Zustand store so it can be properly reset
 * during HMR and testing. It is updated synchronously
 * (`importingPaths.has(path)` / `add(path)`) so a duplicate call bails out
 * before awaiting anything — no IPC, no refresh, no toast.
 */

import { create } from 'zustand';

interface ImportGuardState {
  importingPaths: Set<string>;
  withImportLock: (path: string, fn: () => Promise<void>) => Promise<boolean>;
  isImportingPath: (path: string) => boolean;
  resetImportGuard: () => void;
}

export const useImportGuardStore = create<ImportGuardState>((set, get) => ({
  importingPaths: new Set<string>(),

  withImportLock: async (path, fn) => {
    const { importingPaths } = get();
    if (importingPaths.has(path)) return false;

    const next = new Set(importingPaths);
    next.add(path);
    set({ importingPaths: next });

    try {
      await fn();
      return true;
    } finally {
      const cleanup = new Set(get().importingPaths);
      cleanup.delete(path);
      set({ importingPaths: cleanup });
    }
  },

  isImportingPath: (path) => get().importingPaths.has(path),

  resetImportGuard: () => set({ importingPaths: new Set() }),
}));

/**
 * Run `fn` under a per-path lock.
 *
 * Returns `true` if `fn` was executed; `false` if the path was already
 * locked (callers should treat this as a silent no-op, not an error).
 *
 * @deprecated Use `useImportGuardStore.getState().withImportLock` instead.
 * This function exists for backward compatibility during migration.
 */
export async function withImportLock(path: string, fn: () => Promise<void>): Promise<boolean> {
  return useImportGuardStore.getState().withImportLock(path, fn);
}

/**
 * Test / inspection helper — do not use in production paths.
 *
 * @deprecated Use `useImportGuardStore.getState().isImportingPath` instead.
 */
export function isImportingPath(path: string): boolean {
  return useImportGuardStore.getState().isImportingPath(path);
}

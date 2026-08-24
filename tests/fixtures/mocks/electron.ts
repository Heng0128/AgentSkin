// SPDX-License-Identifier: MPL-2.0

/**
 * Shared electron mock fixture for Vitest tests.
 *
 * Eliminates duplicate `vi.mock('electron', ...)` definitions across 13+ test
 * files. Provides safe defaults for the most commonly-used electron APIs and
 * an `overrides` parameter for file-specific custom behaviour.
 *
 * Usage:
 *
 *   // 1. Simple — just use defaults (ipcMain.handle captures into handlers map):
 *   import { setupElectronMock } from '../../fixtures/mocks/electron';
 *   const { handlers } = setupElectronMock();
 *
 *   // 2. With overrides (e.g. custom getPath behaviour):
 *   const { handlers } = setupElectronMock({
 *     app: { getPath: vi.fn((name) => name === 'userData' ? TEST_DIR : os.tmpdir()) },
 *   });
 *
 * The returned `handlers` Map captures every handler registered via
 * `ipcMain.handle()` so tests can invoke them directly.
 *
 * Deep merge: overrides are merged one level deep per key, so providing
 * `{ dialog: { showOpenDialog: vi.fn() } }` merges with the default
 * `dialog.showSaveDialog` instead of replacing the entire `dialog` key.
 */

import { vi } from 'vitest';

export interface ElectronMockOverrides {
  // Partial electron module shape — any key here deep-merges over the defaults.
  [key: string]: unknown;
}

export interface SetupElectronMockResult {
  /** Map of channel → handler, populated by the mocked `ipcMain.handle`. */
  handlers: Map<string, (...args: unknown[]) => unknown>;
}

/**
 * Deep-merges `overrides` onto `defaults` one level deep per top-level key.
 * Nested objects are shallow-merged (not recursively deep-merged).
 */
function deepMergeDefaults(
  defaults: Record<string, unknown>,
  overrides: ElectronMockOverrides,
): Record<string, unknown> {
  const result = { ...defaults };
  for (const key of Object.keys(overrides)) {
    const defVal = defaults[key];
    const overVal = overrides[key];
    if (
      defVal !== null &&
      typeof defVal === 'object' &&
      !Array.isArray(defVal) &&
      overVal !== null &&
      typeof overVal === 'object' &&
      !Array.isArray(overVal) &&
      typeof overVal !== 'function'
    ) {
      result[key] = { ...defVal, ...overVal };
    } else {
      result[key] = overVal;
    }
  }
  return result;
}

export function setupElectronMock(
  overrides: ElectronMockOverrides = {},
): SetupElectronMockResult {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();

  const defaults: Record<string, unknown> = {
    // ── ipcMain ──────────────────────────────────────────────────────────────
    ipcMain: {
      handle: vi.fn(
        (channel: string, handler: (...args: unknown[]) => unknown) => {
          handlers!.set(channel, handler);
        },
      ),
      on: vi.fn(),
      removeHandler: vi.fn((channel: string) => {
        handlers!.delete(channel);
      }),
    },
    // ── app ─────────────────────────────────────────────────────────────────
    app: {
      getPath: vi.fn((name: string) => `/mock/path/${name}`),
      getName: vi.fn(() => 'AgentSkin'),
      getLocale: vi.fn(() => 'en-US'),
      isPackaged: false,
      getAppPath: vi.fn(() => '/mock/app-path'),
      getVersion: vi.fn(() => '5.0.0'),
      on: vi.fn(),
      off: vi.fn(),
      setName: vi.fn(),
      dock: undefined,
    },
    // ── dialog ──────────────────────────────────────────────────────────────
    dialog: {
      showOpenDialog: vi
        .fn()
        .mockResolvedValue({ canceled: true, filePaths: [] }),
      showSaveDialog: vi
        .fn()
        .mockResolvedValue({ canceled: true, filePath: undefined }),
    },
    // ── nativeImage ─────────────────────────────────────────────────────────
    nativeImage: {
      createFromPath: vi.fn(() => ({ isEmpty: () => true })),
      createFromBuffer: vi.fn(() => ({ isEmpty: () => true })),
    },
    // ── shell ───────────────────────────────────────────────────────────────
    shell: {
      showItemInFolder: vi.fn(),
    },
    // ── BrowserWindow ───────────────────────────────────────────────────────
    BrowserWindow: class MockBrowserWindow {},
    // ── powerMonitor ────────────────────────────────────────────────────────
    powerMonitor: {
      on: vi.fn(),
      off: vi.fn(),
    },
    // ── Menu / Tray / nativeTheme ────────────────────────────────────────────
    Menu: {
      buildFromTemplate: vi.fn(),
      setApplicationMenu: vi.fn(),
    },
    Tray: vi.fn(),
    nativeTheme: { shouldUseDarkColors: false },
  };

  const merged = deepMergeDefaults(defaults, overrides);

  vi.mock('electron', () => merged);

  return { handlers };
}

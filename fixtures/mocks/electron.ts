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
 *   import { createElectronMock } from '../../../fixtures/mocks/electron';
 *   const handlers = new Map();
 *   vi.mock('electron', () => createElectronMock(handlers));
 *
 *   // 2. With overrides (e.g. custom getPath behaviour):
 *   const handlers = new Map();
 *   vi.mock('electron', () => createElectronMock(handlers, {
 *     app: { getPath: vi.fn((name) => name === 'userData' ? TEST_DIR : os.tmpdir()) },
 *   }));
 *
 * The `handlers` Map captures every handler registered via `ipcMain.handle()`
 * so tests can invoke them directly.
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

export function createElectronMock(
  handlers: Map<string, (...args: unknown[]) => unknown>,
  overrides: ElectronMockOverrides = {},
): Record<string, unknown> {
  // Base defaults — these are the "shared" part of the fixture.
  const mock: Record<string, unknown> = {
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
    dialog: {
      showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
      showSaveDialog: vi.fn().mockResolvedValue({ canceled: true, filePath: undefined }),
    },
    nativeImage: {
      createFromPath: vi.fn(() => ({ isEmpty: () => true })),
      createFromBuffer: vi.fn(() => ({ isEmpty: () => true })),
    },
    shell: {
      showItemInFolder: vi.fn(),
    },
    BrowserWindow: class MockBrowserWindow {},
    powerMonitor: {
      on: vi.fn(),
      off: vi.fn(),
    },
    Menu: {
      buildFromTemplate: vi.fn(),
      setApplicationMenu: vi.fn(),
    },
    Tray: vi.fn(),
    nativeTheme: { shouldUseDarkColors: false },
  };

  // Deep-merge: for each top-level key, if both defaults and overrides have
  // a plain object (not array, not function), shallow-merge them; otherwise
  // the override wins.
  for (const key of Object.keys(overrides)) {
    const defVal = mock[key];
    const overVal = overrides[key];
    if (
      defVal !== null &&
      typeof defVal === 'object' &&
      !Array.isArray(defVal) &&
      typeof defVal !== 'function' &&
      overVal !== null &&
      typeof overVal === 'object' &&
      !Array.isArray(overVal) &&
      typeof overVal !== 'function'
    ) {
      mock[key] = { ...defVal, ...overVal };
    } else {
      mock[key] = overVal;
    }
  }

  // ipcMain always wires into the caller-provided handlers map.
  mock.ipcMain = {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
    on: vi.fn(),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel);
    }),
  };

  return mock;
}

// SPDX-License-Identifier: MPL-2.0

/**
 * # useThemePageController — paste-import loading + toast tests (REQ-D3)
 *
 * Covers three confirmed fixes:
 *   1. During import, `importing` state is true
 *   2. The import button is disabled while importing
 *   3. Import success shows a success toast
 *
 * This is a hook test that requires DOM (useState/useEffect), so we use
 * @testing-library/react's `renderHook` under the `happy-dom` environment.
 */

/**
 * @vitest-environment happy-dom
 */

import type { AppController } from '@/hooks/useAppController';

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mock useThemeCenter hook --------------------------------------------

const mockThemes: Array<{
  id: string;
  name: string;
  hasWallpaper: boolean;
  tags?: string[];
  author?: string;
  version?: string;
  category?: string;
  supportedAgents?: string[];
  installed?: boolean;
  mode?: 'dark' | 'light' | 'auto' | null;
  source?: string;
  preview?: string | null;
  icon?: string | null;
  wallpaper?: { workshopId?: string; video?: string };
}> = [];

vi.mock('@/hooks/useThemeCenter', () => ({
  useThemeCenter: () => ({
    themes: mockThemes,
    allCount: mockThemes.length,
    query: '',
    setQuery: vi.fn(),
    categories: [],
    selectedCategory: null,
    setSelectedCategory: vi.fn(),
    modeFilter: 'all' as const,
    setModeFilter: vi.fn(),
    dynamicFilter: 'all' as const,
    setDynamicFilter: vi.fn(),
    hasDynamic: false,
    sortBy: 'name' as const,
    setSortBy: vi.fn(),
    sortOrder: 'asc' as const,
    setSortOrder: vi.fn(),
  }),
}));

// --- Mock api client (hoisted so vi.mock can reference it) -----------------

const { mockImportThemeBytes, mockRefreshThemesPage } = vi.hoisted(() => ({
  mockImportThemeBytes: vi.fn(),
  mockRefreshThemesPage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/api/agentSkinClient', () => ({
  api: {
    importThemeBytes: mockImportThemeBytes,
  },
}));

vi.mock('@/stores/themeStore', () => ({
  useThemeStore: {
    getState: () => ({
      refreshThemes: mockRefreshThemesPage,
    }),
  },
}));

// --- Mock theme-string-format utilities ----------------------------------

vi.mock('@shared/utils/theme-string-format', () => ({
  validateThemeString: vi.fn(() => ({ valid: true, errors: [] as string[] })),
  decodeThemeFromString: vi.fn(() => ({ id: 'imported-theme', name: 'Imported' })),
  encodeThemeToString: vi.fn(() => 'encoded-string'),
}));

// --- Mock minimal controller ---------------------------------------------

const mockShowToast = vi.fn();
const mockRefreshThemes = vi.fn().mockResolvedValue(undefined);
const mockSetSelection = vi.fn();
const mockInstalledById = vi.fn();

function makeController(): AppController {
  return {
    t: {
      importFailed: 'Import failed',
      importSuccess: (name: string) => `Imported ${name}`,
      copyThemeString: 'Copied',
    },
    status: { apps: [] },
    selection: null,
    setSelection: mockSetSelection,
    showToast: mockShowToast,
    refreshThemes: mockRefreshThemes,
    installedById: mockInstalledById,
    applyToApp: vi.fn().mockResolvedValue(undefined),
    dropThemeFiles: vi.fn(),
  } as unknown as AppController;
}

// --- Import hook AFTER mocks are registered -------------------------------

import { useThemePageController } from './useThemePageController';

// --- Tests ----------------------------------------------------------------

describe('useThemePageController — paste-import loading + toast (REQ-D3)', () => {
  beforeEach(() => {
    mockImportThemeBytes.mockReset();
    mockShowToast.mockReset();
    mockRefreshThemes.mockReset();
    mockSetSelection.mockReset();
    mockInstalledById.mockReset();
  });

  it('D3.1: importing starts as false', () => {
    const { result } = renderHook(() => useThemePageController(makeController()));
    expect(result.current.importing).toBe(false);
  });

  it('D3.2: importing becomes true during import and false after', async () => {
    // Simulate a successful import that resolves after a tick.
    mockImportThemeBytes.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ theme: { displayName: 'Imported Theme' } }), 10),
        ),
    );

    const controller = makeController();
    const { result } = renderHook(() => useThemePageController(controller));

    // Start the import.
    act(() => {
      result.current.setPasteInput('valid-theme-string');
    });

    // Trigger the import via handlePasteImport.
    act(() => {
      void result.current.handlePasteImport();
    });

    // After triggering, importing should be true.
    expect(result.current.importing).toBe(true);

    // Wait for the import to complete.
    await waitFor(() => {
      expect(result.current.importing).toBe(false);
    });
  });

  it('D3.3: import success shows success toast and closes dialog', async () => {
    mockImportThemeBytes.mockResolvedValue({
      theme: { displayName: 'Aurora Imported' },
    });

    const controller = makeController();
    const { result } = renderHook(() => useThemePageController(controller));

    act(() => {
      result.current.setPasteInput('valid-theme-string');
    });

    await act(async () => {
      await result.current.handlePasteImport();
    });

    // Success toast should be called with the theme name.
    expect(mockShowToast).toHaveBeenCalledWith('Imported Aurora Imported');
    // Paste dialog should be closed.
    expect(result.current.showPasteDialog).toBe(false);
    // Paste input should be cleared.
    expect(result.current.pasteInput).toBe('');
  });

  it('D3.4: import failure shows error toast', async () => {
    mockImportThemeBytes.mockRejectedValue(new Error('Network error'));

    const controller = makeController();
    const { result } = renderHook(() => useThemePageController(controller));

    act(() => {
      result.current.setPasteInput('valid-theme-string');
    });

    await act(async () => {
      await result.current.handlePasteImport();
    });

    // Error toast should be called with destructive tone.
    expect(mockShowToast).toHaveBeenCalledWith('Import failed', 'destructive');
    // importing should be back to false.
    expect(result.current.importing).toBe(false);
  });

  it('D3.5: invalid theme string sets pasteError', async () => {
    // Re-mock validateThemeString to return invalid.
    const { validateThemeString } = await import('@shared/utils/theme-string-format');
    (validateThemeString as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      valid: false,
      errors: ['Invalid format'],
    });

    const controller = makeController();
    const { result } = renderHook(() => useThemePageController(controller));

    act(() => {
      result.current.setPasteInput('garbage');
    });

    await act(async () => {
      await result.current.handlePasteImport();
    });

    expect(result.current.pasteError).toBe('Invalid format');
    expect(mockShowToast).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// REQ-B-004: handlePasteImport refreshes theme catalog on success
// ---------------------------------------------------------------------------

describe('useThemePageController — handlePasteImport refreshThemes (REQ-B-004)', () => {
  beforeEach(() => {
    mockImportThemeBytes.mockReset();
    mockShowToast.mockReset();
    mockRefreshThemes.mockReset();
    mockSetSelection.mockReset();
    mockInstalledById.mockReset();
    mockRefreshThemesPage.mockReset();
  });

  it('calls useThemeStore.refreshThemes() after successful paste import', async () => {
    mockImportThemeBytes.mockResolvedValue({
      theme: { displayName: 'Imported Aurora' },
    });

    const controller = makeController();
    const { result } = renderHook(() => useThemePageController(controller));

    act(() => {
      result.current.setPasteInput('valid-theme-string');
    });

    await act(async () => {
      await result.current.handlePasteImport();
    });

    // REQ-B-004: ThemesPage catalog should be refreshed after import
    expect(mockRefreshThemesPage).toHaveBeenCalledTimes(1);
  });

  it('does not call refreshThemes when paste import fails', async () => {
    mockImportThemeBytes.mockRejectedValue(new Error('Network error'));

    const controller = makeController();
    const { result } = renderHook(() => useThemePageController(controller));

    act(() => {
      result.current.setPasteInput('valid-theme-string');
    });

    await act(async () => {
      await result.current.handlePasteImport();
    });

    // On failure, refreshThemes should not be called
    expect(mockRefreshThemesPage).not.toHaveBeenCalled();
  });
});

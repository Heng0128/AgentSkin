// SPDX-License-Identifier: MPL-2.0

/**
 * # studioStore tests — image→theme extraction pipeline
 *
 * Verifies the four image→theme actions (`extractImageFromImage`,
 * `applyImageToTheme`, `clearImageToTheme`, `setImageAccent`) and their
 * lifecycle state transitions.
 *
 * External modules (`@/api/agentSkinClient`, `@/stores/notificationStore`,
 * `@/stores/shellStore`) are mocked via `vi.hoisted` + `vi.mock` so tests run
 * without Electron IPC.
 */

import type { ThemeColorsFromImage } from '@shared/types/theme';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockExtractThemeFromImage, mockSaveStudioProject, mockShowToast } = vi.hoisted(() => ({
  mockExtractThemeFromImage: vi.fn(),
  mockSaveStudioProject: vi.fn(),
  mockShowToast: vi.fn(),
}));

vi.mock('@/api/agentSkinClient', () => ({
  api: {
    extractThemeFromImage: mockExtractThemeFromImage,
    saveStudioProject: mockSaveStudioProject,
  },
}));

vi.mock('@/stores/notificationStore', () => ({
  useNotificationStore: {
    getState: vi.fn(() => ({
      showToast: mockShowToast,
    })),
  },
}));

vi.mock('@/stores/shellStore', () => ({
  useShellStore: {
    getState: vi.fn(() => ({
      locale: 'en' as const,
    })),
  },
}));

// Import AFTER all mocks are in place
import { useStudioStore } from '../studioStore';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockPalette: ThemeColorsFromImage = {
  mode: 'dark',
  accent: '#abc',
  secondary: '#9ece6a',
  background: '#0f1419',
  foreground: '#e6edf3',
  muted: '#8b949e',
  surface: '#eee',
  surfaceElevated: '#21262d',
  border: '#30363d',
  codeBackground: '#0d1117',
  codeForeground: '#e6edf3',
  inputBackground: '#21262d',
  buttonBackground: '#7aa2f718',
  buttonForeground: '#e6edf3',
  focusRing: '#7aa2f760',
};

/** Reset store image→theme state to a clean slate before each test. */
const resetImageState = () => {
  useStudioStore.setState({
    imageToThemeStatus: 'idle',
    imageToThemeError: null,
    imageToThemeMode: null,
    imageToThemePalette: null,
    imageToThemeAccent: null,
    toolOverrides: null,
    previewView: 'theme',
    projects: [],
    activeProjectId: null,
  });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('studioStore — image→theme', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetImageState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // 1. extractImageFromImage — success path
  // -----------------------------------------------------------------------

  it('transitions to ready and stores palette + mode when extraction succeeds', async () => {
    mockExtractThemeFromImage.mockResolvedValueOnce({
      palette: mockPalette,
      mode: 'dark' as const,
    });

    await useStudioStore.getState().extractImageFromImage('base64-data');

    const state = useStudioStore.getState();
    expect(state.imageToThemeStatus).toBe('ready');
    expect(state.imageToThemePalette).toEqual(mockPalette);
    expect(state.imageToThemeMode).toBe('dark');
    expect(state.imageToThemeError).toBeNull();
    expect(state.imageToThemeAccent).toBeNull();
    expect(mockExtractThemeFromImage).toHaveBeenCalledWith('base64-data');
  });

  // -----------------------------------------------------------------------
  // 2. extractImageFromImage — failure path
  // -----------------------------------------------------------------------

  it('transitions to error and sets imageToThemeError when extraction fails', async () => {
    mockExtractThemeFromImage.mockRejectedValueOnce(new Error('boom'));

    await useStudioStore.getState().extractImageFromImage('bad-data');

    const state = useStudioStore.getState();
    expect(state.imageToThemeStatus).toBe('error');
    expect(state.imageToThemeError).toBe('Color extraction failed');
    expect(state.imageToThemePalette).toBeNull();
  });

  // -----------------------------------------------------------------------
  // 3. Concurrent lock: second call intercepted
  // -----------------------------------------------------------------------

  it('intercepts the second concurrent call via the busy lock', async () => {
    let resolveFirst!: (value: { palette: typeof mockPalette; mode: 'dark' }) => void;
    mockExtractThemeFromImage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );

    // First call acquires the lock (does not resolve yet).
    const firstPromise = useStudioStore.getState().extractImageFromImage('data-1');

    // Second call should be intercepted immediately.
    await useStudioStore.getState().extractImageFromImage('data-2');

    // Only one API call should have been made.
    expect(mockExtractThemeFromImage).toHaveBeenCalledTimes(1);

    // Status is still 'extracting' (lock held, no resolution).
    expect(useStudioStore.getState().imageToThemeStatus).toBe('extracting');

    // Resolve the first call and release the lock.
    resolveFirst({ palette: mockPalette, mode: 'dark' });
    await firstPromise;

    // After resolution, status is ready and only one API was called.
    expect(useStudioStore.getState().imageToThemeStatus).toBe('ready');
    expect(mockExtractThemeFromImage).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // 4. applyImageToTheme — commits palette via setPaletteLoaded and resets
  // -----------------------------------------------------------------------

  it('commits the palette via setPaletteLoaded and resets image→theme state', () => {
    useStudioStore.setState({
      imageToThemeStatus: 'ready',
      imageToThemePalette: mockPalette,
      imageToThemeMode: 'dark',
    });

    useStudioStore.getState().applyImageToTheme();

    // setPaletteLoaded updates toolOverrides with the mapped palette fields.
    const state = useStudioStore.getState();
    expect(state.toolOverrides).toMatchObject({
      accent: mockPalette.accent,
      background: mockPalette.background,
      foreground: mockPalette.foreground,
      surface: mockPalette.surface,
    });
    expect(state.previewView).toBe('theme');
    // image→theme state is reset to idle.
    expect(state.imageToThemeStatus).toBe('idle');
    expect(state.imageToThemePalette).toBeNull();
    expect(state.imageToThemeAccent).toBeNull();
    expect(state.imageToThemeMode).toBeNull();
    expect(state.imageToThemeError).toBeNull();
  });

  // -----------------------------------------------------------------------
  // 5. applyImageToTheme — no-op when palette is null
  // -----------------------------------------------------------------------

  it('is a no-op when imageToThemePalette is null', () => {
    // Status is idle, palette is null (default).
    const before = useStudioStore.getState();
    expect(before.imageToThemePalette).toBeNull();

    useStudioStore.getState().applyImageToTheme();

    // No state change.
    const after = useStudioStore.getState();
    expect(after.toolOverrides).toBeNull();
    expect(after.imageToThemeStatus).toBe('idle');
  });

  // -----------------------------------------------------------------------
  // 6. setImageAccent override survives applyImageToTheme
  // -----------------------------------------------------------------------

  it('applies the accent override into the committed palette', () => {
    useStudioStore.setState({
      imageToThemeStatus: 'ready',
      imageToThemePalette: mockPalette,
      imageToThemeAccent: '#override',
    });

    useStudioStore.getState().applyImageToTheme();

    const state = useStudioStore.getState();
    // The committed palette's accent should be the override, not the original.
    expect(state.toolOverrides?.accent).toBe('#override');
    // Full palette is also preserved in colors.
    expect(state.toolOverrides?.colors).toMatchObject({
      accent: '#override',
      background: mockPalette.background,
    });
  });

  // -----------------------------------------------------------------------
  // 7. clearImageToTheme — full reset
  // -----------------------------------------------------------------------

  it('resists all image→theme state to idle', () => {
    useStudioStore.setState({
      imageToThemeStatus: 'ready',
      imageToThemeError: 'some error',
      imageToThemePalette: mockPalette,
      imageToThemeAccent: '#abc',
      imageToThemeMode: 'dark',
    });

    useStudioStore.getState().clearImageToTheme();

    const state = useStudioStore.getState();
    expect(state.imageToThemeStatus).toBe('idle');
    expect(state.imageToThemeError).toBeNull();
    expect(state.imageToThemePalette).toBeNull();
    expect(state.imageToThemeAccent).toBeNull();
    expect(state.imageToThemeMode).toBeNull();
  });
});

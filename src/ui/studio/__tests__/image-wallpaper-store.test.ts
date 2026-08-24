// SPDX-License-Identifier: MPL-2.0

/**
 * # image-wallpaper-store tests
 *
 * Verifies ImageWallpaperState image->theme and wallpaper-preview lifecycle:
 * initial state, setImageAccent, clearImageToTheme (reset), clearWallpaperPreview,
 * and resetAll.
 *
 * External modules (@/api/agentSkinClient, @/stores/notificationStore,
 * @/stores/shellStore, @/studio/capture-store, @/studio/project-store)
 * are mocked via vi.hoisted + vi.mock so tests run without Electron IPC.
 */

import type { ThemeColorsFromImage } from '@shared/types/theme';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockExtractThemeFromImage, mockShowToast } = vi.hoisted(() => ({
  mockExtractThemeFromImage: vi.fn(),
  mockShowToast: vi.fn(),
}));

vi.mock('@/api/agentSkinClient', () => ({
  api: {
    extractThemeFromImage: mockExtractThemeFromImage,
    extractThemeFromWallpaper: vi.fn(),
    previewThemeFromWallpaper: vi.fn(),
    applyThemeFromWallpaper: vi.fn(),
    catalog: {
      themes: {
        list: vi.fn(() => Promise.resolve({ items: [] })),
        get: vi.fn(),
      },
    },
    saveStudioProject: vi.fn(),
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

vi.mock('@/studio/capture-store', () => ({
  useCaptureStore: {
    getState: vi.fn(() => ({
      setPaletteLoaded: vi.fn(),
      setPreviewView: vi.fn(),
    })),
  },
}));

vi.mock('@/studio/project-store', () => ({
  useProjectStore: {
    getState: vi.fn(() => ({
      getActiveProject: vi.fn(() => null),
      activeProjectId: null,
    })),
    setState: vi.fn(),
  },
}));

vi.mock('@shared/theme-mapping', () => ({
  semanticColorsToPalette: vi.fn(() => ({})),
}));

// Import AFTER all mocks are in place
import { useImageWallpaperStore } from '@/studio/image-wallpaper-store';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockPalette: ThemeColorsFromImage = {
  mode: 'dark',
  accent: '#abc',
  accentMuted: '#8fa8d4',
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

/** Reset store to clean slate before each test. */
const resetStore = () => {
  useImageWallpaperStore.setState({
    imageToTheme: {
      status: 'idle',
      error: null,
      mode: null,
      palette: null,
      accent: null,
    },
    wallpaperPreview: {
      palette: null,
      loading: false,
      error: null,
    },
    wallpaperApply: {
      loading: false,
      error: null,
    },
    installedThemes: [],
    themeLibraryOpen: false,
  });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useImageWallpaperStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ------------------------------------------------------------------
  // 1. Initial state
  // ------------------------------------------------------------------

  it('initializes with imageToTheme.status="idle" and null palette', () => {
    const state = useImageWallpaperStore.getState();
    expect(state.imageToTheme.status).toBe('idle');
    expect(state.imageToTheme.palette).toBeNull();
    expect(state.imageToTheme.error).toBeNull();
    expect(state.imageToTheme.mode).toBeNull();
    expect(state.imageToTheme.accent).toBeNull();
    expect(state.wallpaperPreview.palette).toBeNull();
    expect(state.wallpaperPreview.loading).toBe(false);
  });

  // ------------------------------------------------------------------
  // 2. clearImageToTheme — resets to idle
  // ------------------------------------------------------------------

  it('clearImageToTheme resets imageToTheme back to idle', () => {
    useImageWallpaperStore.setState({
      imageToTheme: {
        status: 'ready',
        error: null,
        mode: 'dark',
        palette: mockPalette,
        accent: '#override',
      },
    });

    useImageWallpaperStore.getState().clearImageToTheme();

    const img = useImageWallpaperStore.getState().imageToTheme;
    expect(img.status).toBe('idle');
    expect(img.palette).toBeNull();
    expect(img.error).toBeNull();
    expect(img.mode).toBeNull();
    expect(img.accent).toBeNull();
  });

  // ------------------------------------------------------------------
  // 3. setImageAccent — updates accent field
  // ------------------------------------------------------------------

  it('setImageAccent updates the accent without affecting other fields', () => {
    useImageWallpaperStore.setState({
      imageToTheme: {
        status: 'ready',
        error: null,
        mode: 'dark',
        palette: mockPalette,
        accent: null,
      },
    });

    useImageWallpaperStore.getState().setImageAccent('#ff0000');

    const img = useImageWallpaperStore.getState().imageToTheme;
    expect(img.accent).toBe('#ff0000');
    // Other fields untouched.
    expect(img.status).toBe('ready');
    expect(img.mode).toBe('dark');
    expect(img.palette).toEqual(mockPalette);
  });

  // ------------------------------------------------------------------
  // 4. clearWallpaperPreview — clears preview palette
  // ------------------------------------------------------------------

  it('clearWallpaperPreview resets wallpaperPreview to null palette and loading=false', () => {
    useImageWallpaperStore.setState({
      wallpaperPreview: {
        palette: mockPalette,
        loading: true,
        error: 'some error',
      },
    });

    useImageWallpaperStore.getState().clearWallpaperPreview();

    const wp = useImageWallpaperStore.getState().wallpaperPreview;
    expect(wp.palette).toBeNull();
    expect(wp.loading).toBe(false);
    expect(wp.error).toBeNull();
  });

  // ------------------------------------------------------------------
  // 5. resetAll — resets both imageToTheme and wallpaper state
  // ------------------------------------------------------------------

  it('resetAll clears both imageToTheme and wallpaperPreview', () => {
    useImageWallpaperStore.setState({
      imageToTheme: {
        status: 'ready',
        error: 'old error',
        mode: 'dark',
        palette: mockPalette,
        accent: '#abc',
      },
      wallpaperPreview: {
        palette: mockPalette,
        loading: true,
        error: 'old preview error',
      },
      wallpaperApply: {
        loading: true,
        error: 'old apply error',
      },
    });

    useImageWallpaperStore.getState().resetAll();

    const state = useImageWallpaperStore.getState();
    expect(state.imageToTheme.status).toBe('idle');
    expect(state.imageToTheme.palette).toBeNull();
    expect(state.imageToTheme.accent).toBeNull();
    expect(state.wallpaperPreview.palette).toBeNull();
    expect(state.wallpaperPreview.loading).toBe(false);
    expect(state.wallpaperApply.loading).toBe(false);
  });
});

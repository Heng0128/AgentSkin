// SPDX-License-Identifier: MPL-2.0

/**
 * # image-wallpaper-store
 *
 * Image→theme extraction (pywal-style) and wallpaper→theme live preview state.
 *
 * Extracted from the monolithic `studioStore.ts` as part of the
 * 5-store decomposition (P1-4 weight reduction).
 */

import { api } from '@/api/agentSkinClient';
import { useNotificationStore } from '@/stores/notificationStore';
import { useShellStore } from '@/stores/shellStore';
import { useCaptureStore } from '@/studio/capture-store';
import { useProjectStore } from '@/studio/project-store';

import { toMessage } from '@shared/errors';
import { type UiMessages, uiMessages } from '@shared/i18n';
import { semanticColorsToPalette } from '@shared/theme-mapping';
import type { ThemeCatalogItem, ThemeColorsFromImage } from '@shared/types';
import { create } from 'zustand';

/** Read current i18n message table (project-standard pattern). */
function currentT(): UiMessages {
  return uiMessages[useShellStore.getState().locale];
}

/** Async-lock guards: module-scoped (single studio window). */
const imageBusyLocks = new Set<string>();

function tryAcquireLock(key: string): boolean {
  if (imageBusyLocks.has(key)) return false;
  imageBusyLocks.add(key);
  return true;
}

function releaseLock(key: string): void {
  imageBusyLocks.delete(key);
}

/**
 * Wallpaper→theme preview debounce: 150ms coalescing so sliding the wallpaper
 * picker across many entries doesn't fire a burst of IPC calls.
 */
let wallpaperPreviewTimer: ReturnType<typeof setTimeout> | null = null;

export interface ImageToThemeState {
  status: 'idle' | 'extracting' | 'ready' | 'error';
  error: string | null;
  mode: 'light' | 'dark' | null;
  palette: ThemeColorsFromImage | null;
  accent: string | null;
}

export interface WallpaperPreviewState {
  palette: ThemeColorsFromImage | null;
  loading: boolean;
  error: string | null;
}

export interface WallpaperApplyState {
  loading: boolean;
  error: string | null;
}

export interface ImageWallpaperState {
  // --- Image → Theme ---
  imageToTheme: ImageToThemeState;

  // --- Wallpaper → Theme live preview ---
  wallpaperPreview: WallpaperPreviewState;
  wallpaperApply: WallpaperApplyState;

  // --- Installed-theme library linkage (used by loadThemeIntoProject) ---
  installedThemes: ThemeCatalogItem[];
  themeLibraryOpen: boolean;

  // --- Image → Theme actions ---
  extractImageFromImage(base64Data: string): Promise<void>;
  applyImageToTheme(): void;
  clearImageToTheme(): void;
  setImageAccent(hex: string): void;
  applyWallpaperExtractedPalette(wallpaperId: string): Promise<void>;

  // --- Wallpaper → Theme live preview actions ---
  previewWallpaperTheme(wallpaperId: string): void;
  applyWallpaperTheme(wallpaperId: string): Promise<boolean>;
  clearWallpaperPreview(): void;

  // --- Theme library linkage ---
  refreshThemeLibrary(): Promise<void>;
  loadThemeIntoProject(themeId: string): Promise<void>;

  // --- Misc ---
  setThemeLibraryOpen(v: boolean): void;
  resetAll(): void;
}

export const useImageWallpaperStore = create<ImageWallpaperState>()((set, get) => ({
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

  // ------------------------------------------------------------------
  // Image → Theme actions
  // ------------------------------------------------------------------

  extractImageFromImage: async (base64Data) => {
    if (!tryAcquireLock('image-extract')) return;
    set({ imageToTheme: { ...get().imageToTheme, status: 'extracting', error: null } });
    try {
      const { palette, mode } = await api.extractThemeFromImage(base64Data);
      set({
        imageToTheme: {
          status: 'ready',
          error: null,
          mode,
          palette,
          accent: null,
        },
      });
    } catch (_e) {
      set({
        imageToTheme: {
          ...get().imageToTheme,
          status: 'error',
          error: currentT().studioImageToThemeErrorExtractFailed,
        },
      });
    } finally {
      releaseLock('image-extract');
    }
  },

  applyImageToTheme: () => {
    const { palette, accent } = get().imageToTheme;
    if (!palette) return;
    const finalPalette = accent ? { ...palette, accent } : palette;
    useCaptureStore.getState().setPaletteLoaded(finalPalette as unknown as Record<string, string>);
    set({
      imageToTheme: {
        status: 'idle',
        error: null,
        mode: null,
        palette: null,
        accent: null,
      },
    });
  },

  clearImageToTheme: () =>
    set({
      imageToTheme: {
        status: 'idle',
        error: null,
        mode: null,
        palette: null,
        accent: null,
      },
    }),

  setImageAccent: (hex) => set((s) => ({ imageToTheme: { ...s.imageToTheme, accent: hex } })),

  applyWallpaperExtractedPalette: async (wallpaperId) => {
    const showToast = useNotificationStore.getState().showToast;
    if (!tryAcquireLock('wallpaper-extract')) return;
    try {
      const installed = await api.extractThemeFromWallpaper(wallpaperId);
      const palette = installed?.colors;
      if (!palette || Object.keys(palette).length === 0) {
        showToast(currentT().studioNoPalette, 'destructive');
        return;
      }
      useCaptureStore.getState().setPaletteLoaded(palette);
      useCaptureStore.getState().setPreviewView('theme');
    } catch (e) {
      showToast(
        `${currentT().studioImageToThemeErrorExtractFailed}：${toMessage(e)}`,
        'destructive',
      );
    } finally {
      releaseLock('wallpaper-extract');
    }
  },

  // ------------------------------------------------------------------
  // Wallpaper → Theme live preview actions
  // ------------------------------------------------------------------

  previewWallpaperTheme: (wallpaperId) => {
    if (!wallpaperId) return;
    if (wallpaperPreviewTimer) clearTimeout(wallpaperPreviewTimer);
    wallpaperPreviewTimer = setTimeout(async () => {
      wallpaperPreviewTimer = null;
      set({
        wallpaperPreview: { ...get().wallpaperPreview, loading: true, error: null },
      });
      try {
        const palette = await api.previewThemeFromWallpaper(wallpaperId);
        if (!get().wallpaperPreview.loading) return;
        set({
          wallpaperPreview: { palette, loading: false, error: null },
        });
      } catch (e) {
        set({
          wallpaperPreview: {
            palette: null,
            loading: false,
            error: toMessage(e),
          },
        });
      }
    }, 150);
  },

  applyWallpaperTheme: async (wallpaperId) => {
    const showToast = useNotificationStore.getState().showToast;
    if (!wallpaperId) return false;
    if (get().wallpaperApply.loading) return false;
    const project = useProjectStore.getState().getActiveProject();
    if (!project) {
      showToast(currentT().studioNoActiveProject, 'destructive');
      return false;
    }
    set({ wallpaperApply: { loading: true, error: null } });
    try {
      const installed = await api.applyThemeFromWallpaper(wallpaperId, project.agentId);
      set({ wallpaperApply: { loading: false, error: null } });
      showToast(currentT().studioWallpaperThemeApplied(installed.displayName));
      return true;
    } catch (e) {
      const msg = toMessage(e);
      set({ wallpaperApply: { loading: false, error: msg } });
      showToast(currentT().studioWallpaperThemeApplyFailed(msg), 'destructive');
      return false;
    }
  },

  clearWallpaperPreview: () => {
    if (wallpaperPreviewTimer) {
      clearTimeout(wallpaperPreviewTimer);
      wallpaperPreviewTimer = null;
    }
    set({
      wallpaperPreview: { palette: null, loading: false, error: null },
    });
  },

  // ------------------------------------------------------------------
  // Theme library linkage
  // ------------------------------------------------------------------

  refreshThemeLibrary: async () => {
    try {
      set({ installedThemes: (await api.catalog.themes.list()).items });
    } catch {
      /* ignore — library linkage is best-effort */
    }
  },

  loadThemeIntoProject: async (themeId) => {
    const showToast = useNotificationStore.getState().showToast;
    const project = useProjectStore.getState().getActiveProject();
    if (!project) return;
    try {
      const item = await api.catalog.themes.get(themeId);
      if (!item?.colors) {
        showToast(currentT().studioNoPalette, 'destructive');
        return;
      }
      const palette = semanticColorsToPalette(item.colors);
      if (Object.keys(palette).length === 0) {
        showToast(currentT().studioNoPalette, 'destructive');
        return;
      }
      const next = { ...project, palette, updatedAt: new Date().toISOString() };
      useProjectStore.setState((s) => ({
        projects: s.projects.map((p) => (p.id === next.id ? next : p)),
      }));
      try {
        await api.saveStudioProject(next);
      } catch (e) {
        showToast(currentT().studioSaveFailed(toMessage(e)), 'destructive');
      }
      showToast(currentT().studioPaletteLoaded(item.name));
    } catch {
      showToast(currentT().studioLoadPaletteFailed, 'destructive');
    }
  },

  // ------------------------------------------------------------------
  // Misc
  // ------------------------------------------------------------------

  setThemeLibraryOpen: (v) => set({ themeLibraryOpen: v }),

  resetAll: () => {
    if (wallpaperPreviewTimer) {
      clearTimeout(wallpaperPreviewTimer);
      wallpaperPreviewTimer = null;
    }
    set({
      imageToTheme: {
        status: 'idle',
        error: null,
        mode: null,
        palette: null,
        accent: null,
      },
      wallpaperPreview: { palette: null, loading: false, error: null },
      wallpaperApply: { loading: false, error: null },
    });
  },
}));

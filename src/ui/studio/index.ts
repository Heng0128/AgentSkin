// SPDX-License-Identifier: MPL-2.0

/**
 * # studio (barrel)
 *
 * Re-exports all decomposed Studio sub-stores and their types.
 */

export type { StudioBundle } from './bundle-store';
export { useBundleStore } from './bundle-store';
export type { CaptureState, ExportState } from './capture-store';
export { useCaptureStore } from './capture-store';
export type {
  ImageToThemeState,
  ImageWallpaperState,
  WallpaperApplyState,
  WallpaperPreviewState,
} from './image-wallpaper-store';
export { useImageWallpaperStore } from './image-wallpaper-store';
export type { EditingState, ProjectForm, ProjectState } from './project-store';
export { useProjectStore } from './project-store';
export { initStudioCrossSync } from './sync-hooks';

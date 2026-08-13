// SPDX-License-Identifier: MPL-2.0

/**
 * # Studio Workspace IPC — image→theme + wallpaper picker for Workbench
 *
 * Registers lightweight handlers that the Theme Studio Workbench tabs need:
 *
 *   - `studio:image:extract-theme` — decode uploaded image in main process →
 *     sample pixels → derive 14-token palette via `theme-from-image.ts`.
 *     Resource-capped at 8 MiB (matches HeiGe codex hard limit).
 *   - `studio:wallpaper:list` — thin wrapper around `wallpapers.list()` for
 *     the WALLPAPER tab picker. Maps WallpaperInfo → simpler DTO.
 *
 * Bundle operations reuse the existing `bundle-ipc.ts` flows (the create and
 * install handlers there own the dialog / save-path routing). Direct bundle
 * deletion is filesystem-only (rm the `.agentskin-bundle` file).
 */

import { rm } from 'node:fs/promises';
import path from 'node:path';
import { dialog, ipcMain, nativeImage } from 'electron';
import { getMainMessages } from '../../shared/i18n';
import { IpcChannel } from '../../shared/ipc-channels';
import { isSafeThemeId } from '../../shared/theme-id';
import type { InstalledTheme } from '../../shared/types';
import { ThemeInstaller } from '../catalog/theme-installer';
import { ThemePackageLoader } from '../catalog/theme-package-loader';
import type { MainContext } from '../main-context';
import { deriveThemeFromImage } from '../theme/theme-from-image';
import { sampleFromBitmap } from '../theme/wallpaper-theme';
import { bundlesDir, installBundleFromPath } from './bundle-ipc';
import { withMonitoredTimeout } from './with-monitored-timeout';

// --- helpers ---------------------------------------------------------------

/** Max decoded image bytes (8 MiB hard limit, matches HeiGe codex). */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Decode a base64 data URL → nativeImage → down-sample → pixel sample. */
function decodeAndSample(dataUrl: string) {
  const m = /^data:image\/(png|jpe?g|webp|gif|bmp);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error('Unsupported image format — expected PNG/JPG/WebP data URL');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`Image exceeds ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MiB limit`);
  }
  const img = nativeImage.createFromBuffer(buf);
  if (img.isEmpty()) throw new Error('Failed to decode image buffer');
  // Decompression bomb guard: check decoded dimensions before sampling
  const decodedSize = img.getSize();
  const MAX_DIMENSION = 4096;
  if (decodedSize.width > MAX_DIMENSION || decodedSize.height > MAX_DIMENSION) {
    throw new Error(`Image dimensions exceed safe limit (${MAX_DIMENSION}×${MAX_DIMENSION})`);
  }
  // Down-sample longest edge to 48 px (matches wallpaper-theme SAMPLE_MAX_EDGE).
  const size = img.getSize();
  const scale = Math.min(1, 48 / Math.max(size.width, size.height));
  const resized = scale < 1 ? img.resize({ width: Math.round(size.width * scale) }) : img;
  const { width, height } = resized.getSize();
  return sampleFromBitmap(width, height, resized.toBitmap());
}

/** Build a loopback file:// URL for a local thumbnail path. */
function toFileUrl(filePath: string): string | undefined {
  try {
    const { pathToFileURL } = require('node:url') as typeof import('node:url');
    return pathToFileURL(filePath).href;
  } catch {
    return undefined;
  }
}

/**
 * Map WallpaperInfo.projectType → Studio DTO type.
 *
 * WallpaperInfo.projectType: 'video' | 'image' | 'web' | 'scene' | 'application'
 * Studio DTO type:            'scene' | 'video' | 'web' | 'preset'
 *
 * 'image' and 'application' have no Studio equivalent — both collapse to 'preset'.
 */
function mapProjectTypeToStudio(
  projectType: string | undefined,
): 'scene' | 'video' | 'web' | 'preset' {
  switch (projectType) {
    case 'video':
      return 'video';
    case 'web':
      return 'web';
    case 'scene':
      return 'scene';
    // 'image', 'application', and undefined all map to 'preset' (Studio has no
    // equivalent for these WallpaperEngine project types)
    default:
      return 'preset';
  }
}

// --- registration ----------------------------------------------------------

export function registerStudioWorkspaceIpc(ctx: MainContext): void {
  // ── studio:image:extract-theme ─────────────────────────────────────────
  ipcMain.handle(IpcChannel.STUDIO_IMAGE_EXTRACT_THEME, async (_event, dataUrl) => {
    return withMonitoredTimeout(
      IpcChannel.STUDIO_IMAGE_EXTRACT_THEME,
      15000,
      (async () => {
        if (typeof dataUrl !== 'string')
          throw new Error('dataUrl must be a base64 data URL string');
        const sampled = decodeAndSample(dataUrl);
        const palette = deriveThemeFromImage({ colors: sampled });
        return { palette, mode: palette.mode };
      })(),
    );
  });

  // ── studio:wallpaper:list ──────────────────────────────────────────────
  // Thin wrapper: the WallpaperService already owns the canonical list.
  ipcMain.handle(IpcChannel.STUDIO_WALLPAPER_LIST, async () => {
    try {
      const list = await withMonitoredTimeout(
        IpcChannel.STUDIO_WALLPAPER_LIST,
        15000,
        ctx.wallpapers?.list() ?? Promise.resolve([]),
      );
      return (list ?? []).map((w) => ({
        id: w.id,
        name: w.title,
        // Map WallpaperInfo.projectType ('video'|'image'|'web'|'scene'|'application')
        // to Studio DTO type ('scene'|'video'|'web'|'preset'). The 'application'
        // type has no Studio equivalent — collapse it to 'preset'.
        type: mapProjectTypeToStudio(w.projectType),
        thumbUrl: w.previewUrl ? toFileUrl(w.previewUrl) : undefined,
      }));
    } catch {
      return [];
    }
  });

  // ── studio:bundle:list ──────────────────────────────────────────────────
  // List installed bundles by scanning userData/bundles/<id>/ directories.
  ipcMain.handle(IpcChannel.STUDIO_BUNDLE_LIST, async () => {
    return withMonitoredTimeout(
      IpcChannel.STUDIO_BUNDLE_LIST,
      15000,
      (async () => {
        const { promises: fs } = await import('node:fs');
        const dir = bundlesDir(ctx.userDataRoot);
        try {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          const results: Array<{
            id: string;
            name: string;
            themeId?: string;
            hasWallpaper: boolean;
            createdAt: string;
          }> = [];
          for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            // Check whether the bundle contains a video wallpaper (manifest probe).
            let hasWallpaper = false;
            try {
              const manifestRaw = await fs.readFile(
                path.join(dir, entry.name, 'manifest.json'),
                'utf8',
              );
              const manifest = JSON.parse(manifestRaw) as { wallpaper?: unknown };
              hasWallpaper = !!manifest.wallpaper;
            } catch {
              // No manifest → treat as theme-only bundle.
            }
            results.push({
              id: entry.name,
              name: entry.name,
              themeId: entry.name,
              hasWallpaper,
              createdAt: '',
            });
          }
          return results;
        } catch {
          return [];
        }
      })(),
    );
  });

  // ── studio:bundle:install ───────────────────────────────────────────────
  // Install a bundle by id (already unpacked in userData/bundles/<id>/).
  // Loads the package via ThemePackageLoader + ThemeInstaller (no dialog, no tar).
  ipcMain.handle(IpcChannel.STUDIO_BUNDLE_INSTALL_BY_ID, async (_event, id) => {
    return withMonitoredTimeout(
      IpcChannel.STUDIO_BUNDLE_INSTALL_BY_ID,
      15000,
      (async () => {
        if (typeof id !== 'string' || !isSafeThemeId(id)) {
          throw new Error('id must be a valid theme id');
        }
        const { promises: fs } = await import('node:fs');
        const bundleDir = path.join(bundlesDir(ctx.userDataRoot), id);
        try {
          await fs.access(bundleDir);
        } catch {
          return { ok: false, error: `Bundle ${id} not found` };
        }
        try {
          const loader = new ThemePackageLoader(bundlesDir(ctx.userDataRoot));
          const pkg = await loader.load(id);
          const installer = new ThemeInstaller(ctx.library);
          await installer.install(pkg, bundlesDir(ctx.userDataRoot));
          return { ok: true };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      })(),
    );
  });

  // ── studio:bundle:import ────────────────────────────────────────────────
  // Reuse the existing install flow (handles unpack → validate → install).
  ipcMain.handle(IpcChannel.STUDIO_BUNDLE_IMPORT, async () => {
    return withMonitoredTimeout(
      IpcChannel.STUDIO_BUNDLE_IMPORT,
      60000,
      (async () => {
        const copy = getMainMessages();
        const { filePaths } = await dialog.showOpenDialog({
          title: copy.bundleInstallDialogTitle ?? '导入 .agentskin-bundle',
          filters: [{ name: 'Bundle', extensions: ['agentskin-bundle'] }],
          properties: ['openFile'],
        });
        if (filePaths.length === 0) return null;
        const installed: InstalledTheme = await installBundleFromPath(ctx, filePaths[0]);
        return { id: installed.id, name: installed.displayName };
      })(),
    );
  });

  // ── studio:bundle:delete ─────────────────────────────────────────────────
  // Filesystem-level: remove the entire userData/bundles/<id>/ directory.
  ipcMain.handle(IpcChannel.STUDIO_BUNDLE_DELETE, async (_event, id) => {
    return withMonitoredTimeout(
      IpcChannel.STUDIO_BUNDLE_DELETE,
      15000,
      (async () => {
        if (typeof id !== 'string' || !isSafeThemeId(id)) {
          throw new Error('id must be a valid theme id');
        }
        const dir = path.join(bundlesDir(ctx.userDataRoot), id);
        try {
          await rm(dir, { recursive: true, force: true });
          return { ok: true };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      })(),
    );
  });
}

// SPDX-License-Identifier: MPL-2.0

/**
 * # Community Theme IPC
 *
 * IPC handlers for DreamSkin community theme integration. Covers:
 *   - COMMUNITY_THEME_LIST  — paginated, filterable theme list
 *   - COMMUNITY_THEME_GET   — single theme detail
 *   - COMMUNITY_THEME_DOWNLOAD — download + verify + install
 *   - COMMUNITY_DOWNLOAD_CANCEL — abort an in-flight download
 *
 * Download progress is pushed to the main window via COMMUNITY_DOWNLOAD_PROGRESS.
 *
 * Dependencies are injected via `deps` (a {@link MainContext}) so handlers
 * are unit-testable — no implicit singleton import.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { type BrowserWindow, ipcMain } from 'electron';
import { getMainMessages } from '../../shared/i18n';
import { IpcChannel } from '../../shared/ipc-channels';
import type {
  CommunityThemeDetail,
  CommunityThemeListParams,
  CommunityThemeListResult,
  DownloadProgress,
  InstallResult,
} from '../../shared/types/community';
import {
  DreamSkinApiError,
  downloadTheme,
  fetchThemes,
  getThemeDetail,
} from '../community/community-theme-api';
import { convertThemePackage } from '../community/community-theme-converter';
import type { MainContext } from '../main-context';
import { notifyStatusChanged, sendLog } from '../main-context';
import { MAX_THEME_PACKAGE_BYTES as MAX_IMPORT_BYTES } from '../theme/utils';
import { withMonitoredTimeout } from './with-monitored-timeout';

/** Active downloads keyed by community theme id. */
const activeDownloads = new Map<string, AbortController>();

export function registerCommunityThemeIpc(deps: MainContext): void {
  const mainWindow = deps.mainWindow;

  // --- List community themes ---
  ipcMain.handle(IpcChannel.COMMUNITY_THEME_LIST, async (_event, params: unknown) => {
    return withMonitoredTimeout(
      IpcChannel.COMMUNITY_THEME_LIST,
      30_000,
      (async () => {
        const listParams = (params ?? {}) as CommunityThemeListParams;
        const result: CommunityThemeListResult = await fetchThemes(listParams);
        return { success: true as const, data: result };
      })(),
    ).catch((error: unknown) => ({
      success: false as const,
      error: error instanceof DreamSkinApiError ? error.message : getFallbackError('list'),
    }));
  });

  // --- Get single theme detail ---
  ipcMain.handle(IpcChannel.COMMUNITY_THEME_GET, async (_event, themeId: unknown) => {
    return withMonitoredTimeout(
      IpcChannel.COMMUNITY_THEME_GET,
      30_000,
      (async () => {
        if (typeof themeId !== 'string' || !themeId) {
          throw new Error(getMainMessages().invalidThemeId);
        }
        const result: CommunityThemeDetail = await getThemeDetail(themeId);
        return { success: true as const, data: result };
      })(),
    ).catch((error: unknown) => ({
      success: false as const,
      error: error instanceof DreamSkinApiError ? error.message : getFallbackError('get'),
    }));
  });

  // --- Download, verify, and install a community theme ---
  ipcMain.handle(IpcChannel.COMMUNITY_THEME_DOWNLOAD, async (_event, themeId: unknown) => {
    if (typeof themeId !== 'string' || !themeId) {
      return {
        success: false as const,
        data: { success: false, error: getMainMessages().invalidThemeId },
      };
    }

    // Guard against duplicate downloads for the same theme.
    if (activeDownloads.has(themeId)) {
      return {
        success: false as const,
        data: { success: false, error: 'A download for this theme is already in progress' },
      };
    }

    const abortController = new AbortController();
    activeDownloads.set(themeId, abortController);

    try {
      const result = await withMonitoredTimeout(
        IpcChannel.COMMUNITY_THEME_DOWNLOAD,
        180_000,
        performDownload(themeId, abortController, mainWindow, deps),
      );

      return { success: true as const, data: result };
    } catch (error: unknown) {
      const result: InstallResult = {
        success: false,
        error: error instanceof DreamSkinApiError ? error.message : getFallbackError('download'),
      };
      return { success: false as const, data: result };
    } finally {
      notifyStatusChanged();
      activeDownloads.delete(themeId);
    }
  });

  // --- Cancel an in-progress download ---
  ipcMain.handle(IpcChannel.COMMUNITY_DOWNLOAD_CANCEL, async (_event, themeId: unknown) => {
    if (typeof themeId !== 'string' || !themeId) {
      return { success: false as const, error: getMainMessages().invalidThemeId };
    }
    const controller = activeDownloads.get(themeId);
    if (controller) {
      controller.abort();
      activeDownloads.delete(themeId);
      sendLog(`[community] download cancelled for theme ${themeId}`);
    }
    return { success: true as const };
  });
}

/**
 * Core download pipeline: fetch detail → download ZIP → verify SHA-256 →
 * install into the local theme library.
 */
async function performDownload(
  themeId: string,
  abortController: AbortController,
  mainWindow: BrowserWindow | null,
  deps: MainContext,
): Promise<InstallResult> {
  // 1. Fetch theme detail (for SHA-256 + metadata).
  const detail = await getThemeDetail(themeId);

  // 2. Download the package with progress reporting. The net.fetch initiated
  //    download will be aborted when the AbortController fires (on cancel).
  pushProgress(mainWindow, themeId, 'downloading', 0, 0, 0);

  const zipBuffer = await downloadTheme(themeId, (bytesDownloaded, totalBytes) => {
    if (abortController.signal.aborted) return;
    const pct = totalBytes > 0 ? Math.round((bytesDownloaded / totalBytes) * 100) : 0;
    pushProgress(mainWindow, themeId, 'downloading', pct, bytesDownloaded, totalBytes);
  });

  if (abortController.signal.aborted) {
    throw new DreamSkinApiError('Download cancelled');
  }

  // 3. Size guard (belt-and-suspenders with the API client's own cap).
  if (zipBuffer.length > MAX_IMPORT_BYTES) {
    throw new DreamSkinApiError(getMainMessages().packageTooLarge(MAX_IMPORT_BYTES / 1024 / 1024));
  }

  // 4. Verify SHA-256 if the community API provided a checksum.
  if (detail.packageSha256) {
    pushProgress(mainWindow, themeId, 'verifying', 99, zipBuffer.length, zipBuffer.length);
    const actualHash = createHash('sha256').update(zipBuffer).digest('hex');
    if (actualHash !== detail.packageSha256) {
      throw new DreamSkinApiError('SHA-256 integrity check failed — the package may be corrupted');
    }
  }

  // 5. Convert DreamSkin ZIP → v1 `.agentskin-theme` package.
  //    The ZIP contains theme.json + theme.css + hero image — none of which
  //    is a valid agentskin-theme JSON. We must extract, convert, and inline
  //    CSS + base64 hero into the v1 schema that validateThemePackage accepts.
  pushProgress(mainWindow, themeId, 'installing', 50, zipBuffer.length, zipBuffer.length);

  const converted = await convertThemePackage(zipBuffer, detail);

  // 6. Write the v1 package JSON to a temp file, then install via installFile.
  //    installFile reads the file, validates it, and copies to the theme library.
  let tempPath = '';
  try {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'community-install-'));
    // installFile expects the .agentskin-theme extension
    tempPath = path.join(tempDir, `${converted.themeId}.agentskin-theme`);
    fs.writeFileSync(tempPath, converted.manifestJson, 'utf-8');

    pushProgress(mainWindow, themeId, 'installing', 99, zipBuffer.length, zipBuffer.length);

    const installed = await deps.library.installFile(tempPath);

    pushProgress(mainWindow, themeId, 'installing', 100, zipBuffer.length, zipBuffer.length);

    return {
      success: true,
      themeId: installed.id,
    };
  } finally {
    // Clean up temp file + directory
    if (tempPath) {
      fs.rmSync(path.dirname(tempPath), { recursive: true, force: true });
    }
  }
}

function pushProgress(
  mainWindow: BrowserWindow | null,
  themeId: string,
  phase: DownloadProgress['phase'],
  progress: number,
  bytesDownloaded: number,
  totalBytes: number,
): void {
  if (mainWindow?.isDestroyed?.() === false) {
    const payload: DownloadProgress = { themeId, phase, progress, bytesDownloaded, totalBytes };
    mainWindow.webContents.send(IpcChannel.COMMUNITY_DOWNLOAD_PROGRESS, payload);
  }
}

function getFallbackError(operation: string): string {
  return `[community] ${operation} failed`;
}

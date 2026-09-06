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
  CommunitySourceId,
  CommunitySourceProbeResult,
  CommunityThemeDetail,
  CommunityThemeListParams,
  CommunityThemeListResult,
  DownloadProgress,
  InstallationRecord,
  InstallResult,
} from '../../shared/types/community';
import {
  CodeDrobeApiError,
  downloadCodeDrobeTheme,
  fetchCodeDrobeDetail,
  fetchCodeDrobeList,
} from '../community/codedrobe-api';
import {
  loadCommunityInstallLog,
  saveCommunityInstallLog,
} from '../community/community-install-store';
import {
  DreamSkinApiError,
  downloadTheme,
  fetchThemes,
  getThemeDetail,
} from '../community/community-theme-api';
import { convertThemePackage } from '../community/community-theme-converter';
import { probeCommunitySource } from '../community/health-probe';
import { mainInfo } from '../logger';
import type { MainContext } from '../main-context';
import { notifyStatusChanged, sendLog } from '../main-context';
import { MAX_THEME_PACKAGE_BYTES as MAX_IMPORT_BYTES } from '../theme/utils';
import { withMonitoredTimeout } from './with-monitored-timeout';

/** CodeDrobe .codedrobe-theme 包体积上限（JSON 格式，比 ZIP 大） */
const MAX_CODEDROBE_BYTES = 30 * 1024 * 1024; // 30 MB

/** Active downloads keyed by community theme id. */
const activeDownloads = new Map<string, AbortController>();

/** 每个 themeId 首次收到数据块的日志守卫（诊断"进度冻 0"）。 */
const progressFirstChunkLogged = new Set<string>();

/** 阶段日志：打到主进程终端（[Main] [INFO] [community]），供流水线定位。 */
function stageLog(msg: string): void {
  mainInfo('community', msg);
}

export function registerCommunityThemeIpc(deps: MainContext): void {
  const mainWindow = deps.mainWindow;

  // --- List community themes ---
  ipcMain.handle(IpcChannel.COMMUNITY_THEME_LIST, async (_event, params: unknown) => {
    return withMonitoredTimeout(
      IpcChannel.COMMUNITY_THEME_LIST,
      30_000,
      (async () => {
        const listParams = (params ?? {}) as CommunityThemeListParams;
        // 按 sourceId 路由：codedrobe → CodeDrobe API，其余 → DreamSkin
        let result: CommunityThemeListResult;
        if (listParams.sourceId === 'codedrobe') {
          result = await fetchCodeDrobeList(listParams);
        } else {
          result = await fetchThemes(listParams);
        }
        return { success: true as const, data: result };
      })(),
    ).catch((error: unknown) => ({
      success: false as const,
      error:
        error instanceof DreamSkinApiError || error instanceof CodeDrobeApiError
          ? error.message
          : getFallbackError('list'),
    }));
  });

  // --- Get single theme detail ---
  ipcMain.handle(
    IpcChannel.COMMUNITY_THEME_GET,
    async (_event, themeId: unknown, sourceId?: unknown) => {
      return withMonitoredTimeout(
        IpcChannel.COMMUNITY_THEME_GET,
        30_000,
        (async () => {
          if (typeof themeId !== 'string' || !themeId) {
            throw new Error(getMainMessages().invalidThemeId);
          }
          let result: CommunityThemeDetail;
          if (sourceId === 'codedrobe') {
            result = await fetchCodeDrobeDetail(themeId);
          } else {
            result = await getThemeDetail(themeId);
          }
          return { success: true as const, data: result };
        })(),
      ).catch((error: unknown) => ({
        success: false as const,
        error:
          error instanceof DreamSkinApiError || error instanceof CodeDrobeApiError
            ? error.message
            : getFallbackError('get'),
      }));
    },
  );

  // --- Download, verify, and install a community theme ---
  ipcMain.handle(
    IpcChannel.COMMUNITY_THEME_DOWNLOAD,
    async (_event, themeId: unknown, sourceId?: unknown) => {
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
        let result: InstallResult;
        if (sourceId === 'codedrobe') {
          // CodeDrobe 独立 pipeline（下载 .codedrobe-theme JSON，直接安装）
          result = await withMonitoredTimeout(
            IpcChannel.COMMUNITY_THEME_DOWNLOAD,
            180_000,
            performCodeDrobeDownload(themeId, abortController, mainWindow, deps),
          );
        } else {
          // DreamSkin pipeline（下载 ZIP → 转换 → 安装）
          result = await withMonitoredTimeout(
            IpcChannel.COMMUNITY_THEME_DOWNLOAD,
            180_000,
            performDownload(themeId, abortController, mainWindow, deps),
          );
        }

        return { success: true as const, data: result };
      } catch (error: unknown) {
        const result: InstallResult = {
          success: false,
          error:
            error instanceof DreamSkinApiError || error instanceof CodeDrobeApiError
              ? error.message
              : getFallbackError('download'),
        };
        return { success: false as const, data: result };
      } finally {
        notifyStatusChanged();
        activeDownloads.delete(themeId);
      }
    },
  );

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

  // --- Probe a source's API health (net.fetch HEAD, main-process side) ---
  ipcMain.handle(IpcChannel.COMMUNITY_SOURCE_PROBE, async (_event, sourceId: unknown) => {
    if (sourceId !== 'dreamskin' && sourceId !== 'codedrobe') {
      const fallback: CommunitySourceProbeResult = {
        sourceId: (sourceId as CommunitySourceId) ?? 'dreamskin',
        activated: false,
        healthy: false,
        errorMessage: 'Unknown community source',
        responseTimeMs: 0,
      };
      return fallback;
    }
    return probeCommunitySource(sourceId);
  });

  // --- Load the persisted community install history ---
  ipcMain.handle(IpcChannel.COMMUNITY_INSTALL_LOG_GET, async () => {
    try {
      const records = await loadCommunityInstallLog(deps.userDataRoot);
      return { success: true as const, data: records };
    } catch (error: unknown) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : 'Failed to load install log',
      };
    }
  });

  // --- Persist the community install history ---
  ipcMain.handle(IpcChannel.COMMUNITY_INSTALL_LOG_SAVE, async (_event, records: unknown) => {
    const clean = Array.isArray(records) ? (records as InstallationRecord[]) : [];
    const ok = await saveCommunityInstallLog(deps.userDataRoot, clean);
    return { success: ok };
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
  stageLog(`install start theme=${themeId}`);
  const detail = await getThemeDetail(themeId);
  stageLog(`detail ok theme=${themeId} sha=${detail.packageSha256 ? 'yes' : 'no'}`);

  // 2. Download the package with progress reporting. The net.fetch initiated
  //    download will be aborted when the AbortController fires (on cancel).
  pushProgress(mainWindow, themeId, 'downloading', 0, 0, 0);

  const zipBuffer = await downloadTheme(
    themeId,
    (bytesDownloaded, totalBytes) => {
      if (abortController.signal.aborted) return;
      // 阶段日志：首字节到达 + Content-Length 是否存在，用于定位"冻 0"。
      if (bytesDownloaded > 0 && !progressFirstChunkLogged.has(themeId)) {
        progressFirstChunkLogged.add(themeId);
        sendLog(
          `[community] download stream started theme=${themeId} contentLength=${totalBytes || 'chunked'}`,
        );
      }
      const pct = totalBytes > 0 ? Math.round((bytesDownloaded / totalBytes) * 100) : 0;
      pushProgress(mainWindow, themeId, 'downloading', pct, bytesDownloaded, totalBytes);
    },
    // 2026-09-03: 把取消信号传入 fetch —— 之前 cancel 只置标志位，实际请求
    // 仍会跑完（或等到 120s 超时），用户"取消"体验失效。
    abortController.signal,
  );
  stageLog(`download complete theme=${themeId} bytes=${zipBuffer.length}`);
  progressFirstChunkLogged.delete(themeId);

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
    stageLog(`sha256 ok theme=${themeId}`);
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
  stageLog(`convert ok theme=${themeId} id=${converted.themeId}`);

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
    stageLog(`installed theme=${themeId} id=${installed.id}`);

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

// ---------------------------------------------------------------------------
// CodeDrobe download pipeline
// ---------------------------------------------------------------------------

/**
 * CodeDrobe 下载 pipeline：下载 → 校验 → 写入 .codedrobe-theme → 安装。
 *
 * 与 DreamSkin pipeline 的关键区别：
 * - CodeDrobe 下载端点直接返回 `.codedrobe-theme` JSON 对象（无需 ZIP 转换）
 * - 无需 convertThemePackage 步骤
 */
async function performCodeDrobeDownload(
  slug: string,
  abortController: AbortController,
  mainWindow: BrowserWindow | null,
  deps: MainContext,
): Promise<InstallResult> {
  // 1. 获取详情（SHA-256 用于校验）
  stageLog(`codedrobe install start theme=${slug}`);
  const detail = await fetchCodeDrobeDetail(slug);
  stageLog(
    `codedrobe detail ok theme=${slug} sha=${detail.packageSha256 ? 'yes' : 'no'} app=${detail.targetAgents.join(',')}`,
  );

  // 2. 下载 .codedrobe-theme JSON 包
  pushProgress(mainWindow, slug, 'downloading', 0, 0, 0);

  const jsonBuffer = await downloadCodeDrobeTheme(
    slug,
    (bytesDownloaded, totalBytes) => {
      if (abortController.signal.aborted) return;
      const pct = totalBytes > 0 ? Math.round((bytesDownloaded / totalBytes) * 100) : 0;
      pushProgress(mainWindow, slug, 'downloading', pct, bytesDownloaded, totalBytes);
    },
    abortController.signal,
  );
  stageLog(`codedrobe download complete theme=${slug} bytes=${jsonBuffer.length}`);

  if (abortController.signal.aborted) {
    throw new CodeDrobeApiError('Download cancelled');
  }

  // 3. 体积校验
  if (jsonBuffer.length > MAX_CODEDROBE_BYTES) {
    throw new CodeDrobeApiError(
      getMainMessages().packageTooLarge(MAX_CODEDROBE_BYTES / 1024 / 1024),
    );
  }

  // 4. SHA-256 校验
  if (detail.packageSha256) {
    pushProgress(mainWindow, slug, 'verifying', 99, jsonBuffer.length, jsonBuffer.length);
    const actualHash = createHash('sha256').update(jsonBuffer).digest('hex');
    stageLog(`codedrobe sha256 verify theme=${slug} match=${actualHash === detail.packageSha256}`);
    if (actualHash !== detail.packageSha256) {
      throw new CodeDrobeApiError('SHA-256 integrity check failed — the package may be corrupted');
    }
  }

  // 5. 写入 .codedrobe-theme 文件并安装
  pushProgress(mainWindow, slug, 'installing', 50, jsonBuffer.length, jsonBuffer.length);

  let tempPath = '';
  try {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codedrobe-install-'));
    // installFile 根据扩展名选择 parser（.codedrobe-theme → codedrobeParser）
    tempPath = path.join(tempDir, `${slug}.codedrobe-theme`);
    fs.writeFileSync(tempPath, jsonBuffer);

    pushProgress(mainWindow, slug, 'installing', 99, jsonBuffer.length, jsonBuffer.length);

    const installed = await deps.library.installFile(tempPath);
    stageLog(`codedrobe installed theme=${slug} id=${installed.id}`);

    pushProgress(mainWindow, slug, 'installing', 100, jsonBuffer.length, jsonBuffer.length);

    return {
      success: true,
      themeId: installed.id,
    };
  } finally {
    if (tempPath) {
      fs.rmSync(path.dirname(tempPath), { recursive: true, force: true });
    }
  }
}

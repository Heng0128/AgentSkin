// SPDX-License-Identifier: MPL-2.0

/**
 * # Theme IPC
 *
 * All theme-related IPC handlers: catalog reads (list/get/search/filter),
 * apply/restore, and package import/export/delete. Extracted from the
 * monolithic `registerIpc` in `main.ts` (H3).
 *
 * `updateTrayMenu` is injected because apply/restore/import/delete all
 * mutate state that the tray menu reflects.
 *
 * Dependencies are injected via `deps` (a {@link MainContext}) so handlers
 * are unit-testable — no implicit singleton import.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { dialog, ipcMain } from 'electron';
import { agentThemeExtension, engineThemeExtension } from '../../legacy/agentskin-core-runtime';
import { getMainMessages } from '../../shared/i18n';
import { IpcChannel } from '../../shared/ipc-channels';
import { type ApplyRequest, type InstalledTheme, isAgentId } from '../../shared/types';
import { exportBundleToZip, isZipBuffer, validateThemeZip } from '../catalog/theme-import-export';
import { isThemePackagePath } from '../file-open';
import { type MainContext, notifyStatusChanged, sendLog, wrapCatalog } from '../main-context';
import type { ThemeBundle } from '../services/theme-bundle';
import type { ThemeUsageTracker } from '../services/theme-usage-tracker';
import { MAX_THEME_PACKAGE_BYTES as MAX_IMPORT_BYTES } from '../theme/utils';
import { convert } from '../theme-asset';
import type { RegenResult } from '../theme-asset/fingerprint';
import { regenerateTheme } from '../theme-asset/fingerprint';
import type { PipelineOutput } from '../theme-asset/pipeline';
import { assertAgentId, assertNonEmptyString, assertSafeThemeId } from './ipc-validators';
import { assertTrustedSender } from './trusted-sender';
import { withMonitoredTimeout } from './with-monitored-timeout';

// Single source of truth for max theme package size — shared with the engine layer.
const THEME_PACKAGE_EXTENSIONS = ['agenttheme', 'agentskin-theme', 'codex-theme'];

/** External format extensions handled by the theme-asset engine. */
const EXTERNAL_THEME_EXTENSIONS = ['.codedrobe-theme', '.vscode-theme', '.css'] as const;

/** True when the file path has a recognized external theme extension. */
function isExternalThemeExtension(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return EXTERNAL_THEME_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Build a minimal engine-format theme bundle from the convert pipeline output,
 * then install it via the library. This bridges the theme-asset engine into
 * the existing ThemeLibrary install flow.
 */
async function installConvertedTheme(
  deps: MainContext,
  pipelineOutput: PipelineOutput,
  displayName: string,
): Promise<InstalledTheme> {
  const bundle = {
    format: 'agentskin-theme',
    schemaVersion: 1,
    theme: {
      id: pipelineOutput.context.adapterResult?.meta?.sourceFormat
        ? `ext-${pipelineOutput.context.adapterResult.meta.sourceFormat}`
        : 'external-theme',
      displayName,
      version: '1.0.0',
      copy: {
        sourceFormat: pipelineOutput.context.adapterResult?.meta?.sourceFormat ?? null,
        author: pipelineOutput.context.adapterResult?.meta?.author ?? null,
        license: pipelineOutput.context.adapterResult?.meta?.license ?? null,
        colors:
          pipelineOutput.context.inferredColors ??
          pipelineOutput.context.adapterResult?.colors ??
          null,
      },
    },
    targets: pipelineOutput.cssOutputs,
  };

  // Write to a temp file and install via the library's importPackage (which
  // validates + normalizes through the legacy core runtime).
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-external-'));
  try {
    const tmpFile = path.join(tmpDir, `external-theme${agentThemeExtension}`);
    await fs.writeFile(tmpFile, JSON.stringify(bundle), 'utf8');
    return await deps.library.importPackage(tmpFile);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Install a validated ZIP theme package into the ThemeLibrary.
 *
 * Reconstructs a ThemeBundle from the validated manifest + extracted files,
 * writes it to a temp `.agenttheme` file, and routes through the library's
 * existing install pipeline (which validates + normalizes via the engine).
 */
async function installZipTheme(
  deps: MainContext,
  result: Awaited<ReturnType<typeof validateThemeZip>>,
): Promise<InstalledTheme> {
  const manifest = result.manifest;
  if (!manifest) throw new Error(getMainMessages().invalidPackage);

  const files = result.files;
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-zip-install-'));
  try {
    // 1. Write per-agent CSS files from the ZIP into a temp directory so we
    //    can reconstruct a ThemeBundle with inline CSS.
    const targets: Record<string, { css: string }> = {};
    if (manifest.targets) {
      for (const [agentId, config] of Object.entries(manifest.targets)) {
        if (config?.css) {
          const cssBuf = files.get(config.css);
          if (cssBuf) {
            targets[agentId] = { css: cssBuf.toString('utf8') };
          }
        }
      }
    }

    // 2. Collect image assets (icon, preview, hero, decorations).
    const images: Record<string, { filename: string; mimeType: string; base64: string }> = {};
    const imageRefs = [manifest.icon, manifest.preview];
    if (manifest.hero) imageRefs.push(manifest.hero);
    if (manifest.assets?.images) {
      imageRefs.push(...Object.values(manifest.assets.images));
    }
    for (const ref of imageRefs) {
      if (!ref) continue;
      const data = files.get(ref);
      if (!data) continue;
      const ext = path.extname(ref).toLowerCase();
      const mimeMap: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
      };
      const imageId = path.basename(ref, ext);
      images[imageId] = {
        filename: path.basename(ref),
        mimeType: mimeMap[ext] ?? 'application/octet-stream',
        base64: data.toString('base64'),
      };
    }

    // 3. Build a ThemeBundle.
    const bundle = {
      format: 'agentskin-theme',
      schemaVersion: 1,
      theme: {
        id: manifest.id,
        displayName: manifest.name,
        version: manifest.version,
        copy: {
          colors: manifest.colors,
          sourceFormat: 'agentskin-theme-zip',
        },
      },
      targets,
      assets: { images },
    };

    // 4. Write to temp file and install via the library.
    const tmpFile = path.join(tmpDir, `${manifest.id}${agentThemeExtension}`);
    await fs.writeFile(tmpFile, JSON.stringify(bundle), 'utf8');
    return await deps.library.importPackage(tmpFile);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

export function registerThemeIpc(
  deps: MainContext,
  updateTrayMenu: () => Promise<void>,
  usageTracker?: ThemeUsageTracker,
): void {
  // --- Catalog reads ---
  ipcMain.handle(IpcChannel.THEME_LIST, async () =>
    wrapCatalog(await deps.themeCatalog.listThemes()),
  );

  ipcMain.handle(IpcChannel.THEME_GET, (_event, id: unknown) => {
    assertSafeThemeId(id);
    return deps.themeCatalog.getTheme(id);
  });

  ipcMain.handle(IpcChannel.THEME_SEARCH, async (_event, query: unknown) => {
    assertNonEmptyString(query, getMainMessages().invalidSearchQuery);
    return wrapCatalog(await deps.themeCatalog.searchThemes(query));
  });

  ipcMain.handle(IpcChannel.THEME_FILTER, async (_event, agentId: unknown) => {
    assertAgentId(agentId);
    return wrapCatalog(await deps.themeCatalog.filterByAgent(agentId));
  });

  // --- Apply / restore ---
  ipcMain.handle(IpcChannel.THEME_APPLY, async (_event, request: ApplyRequest) => {
    return withMonitoredTimeout(
      IpcChannel.THEME_APPLY,
      30000,
      (async () => {
        if (!request || !isAgentId(request.appId) || typeof request.themeId !== 'string') {
          throw new Error(getMainMessages().invalidApplyRequest);
        }
        const result = await deps.core.apply(request);
        // Fire-and-forget: record usage for LRU quick-switch. Does not
        // block the apply response or tray menu update on persistence.
        if (usageTracker) {
          void usageTracker.recordUsage(request.appId, request.themeId);
        }
        void updateTrayMenu();
        notifyStatusChanged();
        return result;
      })(),
    );
  });

  ipcMain.handle(IpcChannel.THEME_RESTORE, async (_event, appId: unknown) => {
    return withMonitoredTimeout(
      IpcChannel.THEME_RESTORE,
      30000,
      (async () => {
        assertAgentId(appId);
        const result = await deps.core.restore(appId);
        void updateTrayMenu();
        notifyStatusChanged();
        return result;
      })(),
    );
  });

  // --- Package import / export / delete ---
  ipcMain.handle(IpcChannel.THEME_IMPORT, async () => {
    return withMonitoredTimeout(
      IpcChannel.THEME_IMPORT,
      60000,
      (async () => {
        const copy = getMainMessages();
        const opts = {
          title: copy.importDialogTitle,
          properties: ['openFile' as const],
          filters: [
            { name: copy.themePackageFilter, extensions: THEME_PACKAGE_EXTENSIONS },
            { name: 'External Themes', extensions: ['codedrobe-theme', 'vscode-theme', 'css'] },
          ],
        };
        const selection = deps.mainWindow
          ? await dialog.showOpenDialog(deps.mainWindow, opts)
          : await dialog.showOpenDialog(opts);
        if (selection.canceled || !selection.filePaths[0]) return { canceled: true };

        const filePath = selection.filePaths[0];

        // External format → route through the theme-asset engine
        if (isExternalThemeExtension(filePath)) {
          const input = { path: filePath, filename: path.basename(filePath) };
          const themeId = path
            .basename(filePath)
            .replace(/\.[^.]+$/, '')
            .toLowerCase();
          const output = await convert(input, { themeId });
          const displayName = output.context.adapterResult?.meta?.name ?? path.basename(filePath);
          const theme = await installConvertedTheme(deps, output, displayName);
          void updateTrayMenu();
          notifyStatusChanged();
          return { canceled: false, path: filePath, theme };
        }

        // ZIP format (.agentskin-theme) → validate via ZIP engine, then
        // reconstruct a ThemeBundle and install through the library.
        if (filePath.endsWith(engineThemeExtension)) {
          const raw = await fs.readFile(filePath);
          if (isZipBuffer(raw)) {
            const result = await validateThemeZip(raw);
            if (!result.ok) {
              throw new Error(getMainMessages().importValidationFailed(result.errors.join('; ')));
            }
            const theme = await installZipTheme(deps, result);
            void updateTrayMenu();
            notifyStatusChanged();
            return { canceled: false, path: filePath, theme };
          }
        }

        // Native format → existing install flow
        const theme = await deps.library.importPackage(filePath);
        void updateTrayMenu();
        notifyStatusChanged();
        return { canceled: false, path: filePath, theme };
      })(),
    );
  });

  // General capability for marketplace / cloud catalog / network theme downloads.
  // Intentionally NOT used for built-in theme seeding — that is owned by the
  // main-process ThemeSeeder on boot.
  ipcMain.handle(
    IpcChannel.THEME_IMPORT_BYTES,
    async (_event, bytes: unknown, suggestedId: unknown) => {
      return withMonitoredTimeout(
        IpcChannel.THEME_IMPORT_BYTES,
        15000,
        (async () => {
          if (!(bytes instanceof Uint8Array) && !Buffer.isBuffer(bytes)) {
            throw new Error(getMainMessages().invalidPackage);
          }
          const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes as Uint8Array);
          if (buffer.length > MAX_IMPORT_BYTES) {
            throw new Error(getMainMessages().packageTooLarge(MAX_IMPORT_BYTES / 1024 / 1024));
          }
          if (typeof suggestedId !== 'string') throw new Error(getMainMessages().invalidPackage);
          const theme = await deps.library.installBytes(buffer, suggestedId);
          void updateTrayMenu();
          notifyStatusChanged();
          return { theme, themes: await deps.library.summaries() };
        })(),
      );
    },
  );

  ipcMain.handle(IpcChannel.THEME_IMPORT_PATH, async (event, filePath: unknown) => {
    assertTrustedSender(event);
    return withMonitoredTimeout(
      IpcChannel.THEME_IMPORT_PATH,
      30000,
      (async () => {
        if (typeof filePath !== 'string' || !isThemePackagePath(filePath)) {
          throw new Error(getMainMessages().invalidPackage);
        }
        const theme = await deps.library.importPackage(filePath);
        void updateTrayMenu();
        notifyStatusChanged();
        return { theme, themes: await deps.library.summaries() };
      })(),
    );
  });

  ipcMain.handle(IpcChannel.THEME_OPEN_FILE, (event, filePath: unknown) => {
    assertTrustedSender(event);
    if (typeof filePath !== 'string' || !isThemePackagePath(filePath)) {
      throw new Error(getMainMessages().invalidPackage);
    }
    deps.fileOpens.handlePath(filePath);
  });

  ipcMain.handle(IpcChannel.THEME_EXPORT, async (_event, themeId: unknown) => {
    return withMonitoredTimeout(
      IpcChannel.THEME_EXPORT,
      30000,
      (async () => {
        assertSafeThemeId(themeId);
        const copy = getMainMessages();
        const entry = await deps.library.find(themeId);
        const saveOpts = {
          title: copy.exportDialogTitle,
          defaultPath: `${entry.bundle.theme.id}-${entry.bundle.theme.version}${engineThemeExtension}`,
          filters: [{ name: copy.themePackageFilter, extensions: THEME_PACKAGE_EXTENSIONS }],
        };
        const selection = deps.mainWindow
          ? await dialog.showSaveDialog(deps.mainWindow, saveOpts)
          : await dialog.showSaveDialog(saveOpts);
        if (selection.canceled || !selection.filePath) return { canceled: true };

        // ZIP format (.agentskin-theme): pack bundle into a portable ZIP archive.
        if (selection.filePath.endsWith(engineThemeExtension)) {
          await exportBundleToZip(entry.bundle as unknown as ThemeBundle, selection.filePath);
        } else {
          // Legacy .agenttheme: copy raw JSON bundle file (backward compat).
          await deps.library.exportPackage(themeId, selection.filePath);
        }
        return { canceled: false, path: selection.filePath };
      })(),
    );
  });

  ipcMain.handle(IpcChannel.THEME_DELETE, async (_event, themeId: unknown) => {
    return withMonitoredTimeout(
      IpcChannel.THEME_DELETE,
      60000,
      (async () => {
        assertSafeThemeId(themeId);
        const status = await deps.core.status();
        const restoreFailures: string[] = [];
        for (const appStatus of status.apps) {
          if (appStatus.activeThemeId === themeId) {
            try {
              await deps.core.restore(appStatus.appId);
            } catch (error) {
              // A single restore failure must not abort the entire delete
              // operation. Log and continue so the remaining agents still get
              // restored and the theme is removed from the library.
              const reason = (error as Error)?.message ?? String(error);
              restoreFailures.push(`${appStatus.appId}: ${reason}`);
            }
          }
        }
        if (restoreFailures.length > 0) {
          sendLog(
            `[theme] delete ${themeId}: ${restoreFailures.length} restore(s) failed: ${restoreFailures.join('; ')}`,
          );
        }
        await deps.library.delete(themeId);
        void updateTrayMenu();
        notifyStatusChanged();
        return {
          themes: await deps.library.summaries(),
          status: await deps.core.status(),
          ...(restoreFailures.length > 0 ? { restoreFailures } : {}),
        };
      })(),
    );
  });

  // --- P3 Self-Healing manual regen ---
  // User-triggered regen from Diagnostics UI. Executes the regen thunk
  // synchronously and returns the result so the UI can show feedback.
  ipcMain.handle(
    IpcChannel.THEME_MANUAL_REGEN,
    async (_event, agentId: unknown, themeId: unknown): Promise<RegenResult> => {
      return withMonitoredTimeout(
        IpcChannel.THEME_MANUAL_REGEN,
        15000,
        (async () => {
          assertAgentId(agentId);
          assertSafeThemeId(themeId);
          // Look up the theme's colors from the catalog so regen has input data.
          // If the theme has no colors recorded (legacy packages), the thunk
          // will fail gracefully with 'no colors available for regen'.
          const themeItem = await deps.themeCatalog.getTheme(themeId);
          const colors = (themeItem?.colors ?? undefined) as
            | import('../catalog/theme-manifest').ThemeColors
            | undefined;
          const thunk = regenerateTheme(agentId, themeId, colors);
          return await thunk();
        })(),
      );
    },
  );

  // --- Theme usage tracking (LRU quick-switch) ---
  // Returns the most frequently used theme ids for an agent, sorted by
  // count desc then lastUsed desc. Used by the quick-switch menu.
  ipcMain.handle(
    IpcChannel.THEME_USAGE_GET,
    (_event, appId: unknown, allThemes: unknown, limit: unknown) => {
      if (!usageTracker) return [];
      assertAgentId(appId);
      if (!Array.isArray(allThemes) || !allThemes.every((t) => typeof t === 'string')) {
        return [];
      }
      const resolvedLimit =
        typeof limit === 'number' && Number.isInteger(limit) && limit > 0 ? limit : undefined;
      return usageTracker.getSortedThemes(appId, allThemes as string[], resolvedLimit);
    },
  );
}

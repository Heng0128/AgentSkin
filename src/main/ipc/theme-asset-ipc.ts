// SPDX-License-Identifier: MPL-2.0

/**
 * # Theme Asset IPC
 *
 * IPC handlers for the theme-asset engine (`src/main/theme-asset/index.ts`).
 * Bridges the renderer to the `convert()` pipeline that transforms external
 * theme formats (codedrobe / legacy-codex / vscode-json / raw-css) into
 * AgentSkin 6-agent CSS.
 *
 * Two channels:
 *   - `THEME_ASSET_CONVERT` — convert an external theme to 6-agent CSS
 *   - `THEME_ASSET_LIST_ADAPTERS` — list available import adapters
 */

import fs from 'node:fs/promises';
import { ipcMain } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels';
import { convert, registerAllAdapters } from '../theme-asset';
import type { AdapterInput } from '../theme-asset/ir/types';
import { withMonitoredTimeout } from './with-monitored-timeout';

/** External format extensions recognized by the import flow. */
const EXTERNAL_EXTENSIONS = ['.codedrobe-theme', '.codex-theme', '.vscode-theme', '.css'] as const;

/** Metadata describing a single import adapter. */
interface AdapterMeta {
  id: string;
  name: string;
  extensions: string[];
  description: string;
}

/** Static adapter metadata (mirrors the registry in adapters/index.ts). */
const ADAPTER_META: AdapterMeta[] = [
  {
    id: 'codedrobe',
    name: 'Codedrobe Theme',
    extensions: ['.codedrobe-theme'],
    description: 'Codedrobe multi-agent theme package (manifest.json + targets/)',
  },
  {
    id: 'legacy-codex',
    name: 'Legacy Codex',
    extensions: ['.codex-theme'],
    description: 'Legacy Codex single-file theme format',
  },
  {
    id: 'vscode-json',
    name: 'VS Code JSON',
    extensions: ['.vscode-theme'],
    description: 'VS Code JSON color theme',
  },
  {
    id: 'raw-css',
    name: 'Raw CSS',
    extensions: ['.css'],
    description: 'Raw CSS variables file',
  },
];

/** Ensure adapters are registered exactly once. */
let adaptersRegistered = false;
function ensureAdapters(): void {
  if (!adaptersRegistered) {
    registerAllAdapters();
    adaptersRegistered = true;
  }
}

/**
 * Register the theme-asset IPC handlers.
 *
 * The engine is currently self-contained and needs no external dependencies
 * from MainContext, so no ctx parameter is required.
 */
export function registerThemeAssetIpc(): void {
  // --- Convert external theme → 6-agent CSS ---
  ipcMain.handle(
    IpcChannel.THEME_ASSET_CONVERT,
    async (
      _event: Electron.IpcMainInvokeEvent,
      input: { kind: 'path' | 'bytes' | 'json'; data: string | Uint8Array; filename?: string },
      _options?: { detectFormat?: boolean; agentIds?: string[] },
    ) => {
      return withMonitoredTimeout(
        IpcChannel.THEME_ASSET_CONVERT,
        30000,
        (async () => {
          ensureAdapters();

          const adapterInput = await buildAdapterInput(input);
          const themeId = deriveThemeId(input.filename, input.data);

          const output = await convert(adapterInput, { themeId });

          return {
            ok: true,
            adapter: output.context.adapterResult?.meta?.sourceFormat,
            confidence: output.context.adapterResult?.confidence,
            tokens: output.context.inferredColors ?? output.context.adapterResult?.colors,
            agentCss: output.cssOutputs,
            report: {
              passed: output.report.passed,
              tokenCoverage: output.report.tokenCoverage,
              warnings: output.report.warnings,
            },
          };
        })(),
      );
    },
  );

  // --- List available adapters ---
  ipcMain.handle(IpcChannel.THEME_ASSET_LIST_ADAPTERS, async () => {
    return withMonitoredTimeout(
      IpcChannel.THEME_ASSET_LIST_ADAPTERS,
      5000,
      (async () => {
        ensureAdapters();
        return ADAPTER_META;
      })(),
    );
  });
}

/** Build an AdapterInput from the IPC payload. */
async function buildAdapterInput(input: {
  kind: 'path' | 'bytes' | 'json';
  data: string | Uint8Array;
  filename?: string;
}): Promise<AdapterInput> {
  if (input.kind === 'path') {
    return { path: input.data as string, filename: input.filename };
  }
  if (input.kind === 'bytes') {
    const buffer = Buffer.isBuffer(input.data)
      ? (input.data as Buffer)
      : Buffer.from(input.data as Uint8Array);
    return { buffer, filename: input.filename };
  }
  // kind === 'json' — serialize to buffer
  const jsonStr = typeof input.data === 'string' ? input.data : JSON.stringify(input.data);
  return { buffer: Buffer.from(jsonStr, 'utf8'), filename: input.filename };
}

/** Derive a safe themeId from the filename or payload. */
function deriveThemeId(filename: string | undefined, data: string | Uint8Array): string {
  if (filename) {
    const base = filename.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9-_]/g, '-');
    if (base) return base.toLowerCase();
  }
  if (typeof data === 'string') {
    return (
      data
        .slice(0, 32)
        .replace(/[^a-zA-Z0-9-_]/g, '-')
        .toLowerCase() || 'external-theme'
    );
  }
  return 'external-theme';
}

/** Check if a filename has a recognized external theme extension. */
export function isExternalThemePath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return EXTERNAL_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Read a file into a Buffer for the IPC convert path. */
export async function readFileToBuffer(filePath: string): Promise<Buffer> {
  return fs.readFile(filePath);
}

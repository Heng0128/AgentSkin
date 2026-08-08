// SPDX-License-Identifier: MPL-2.0

/**
 * # Theme Library Store
 *
 * Extracted from `theme-library.ts` (P4 of the god-object teardown).
 *
 * Implements {@link ThemeLibraryApi} — the persistent theme package store.
 * Installed themes are stored as raw `.agentskin-theme` package files under
 * `userData/themes`. Reads always revalidate through the legacy core runtime,
 * which wraps @agentskin/engine's theme tooling.
 *
 * This module owns only the **store** concern (CRUD over `.agentskin-theme`
 * files + legacy migration). Data transformation utilities live in
 * `utils.ts`, and the scheme constants live in `scheme.ts`.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  agentThemeExtension,
  convertLegacyTheme,
  legacyThemeExtension,
  readTheme,
  themeExtension,
  validateTheme,
} from '../../legacy/agentskin-core-runtime';
import { getMainLocale, getMainMessages } from '../../shared/i18n';
import { isSafeThemeId } from '../../shared/theme-id';
import type { InstalledTheme } from '../../shared/types';
import { mainInfo, mainWarnFromCatch } from '../logger';
import type { PackageInspection, ThemeEntry, ThemeLibraryApi } from '../services/contracts';
import {
  clearCoverCache,
  getCachedCoverPath,
  getCachedIconPath,
  MAX_THEME_PACKAGE_BYTES,
  setCoverDir,
  toInstalledTheme,
} from './utils';

export class ThemeLibrary implements ThemeLibraryApi {
  /**
   * Cached entries from the last successful scan. Invalidated by any mutation
   * (install/delete/import). Without this cache, every `summaries()` call
   * re-reads ALL .agentskin-theme files from disk and JSON-parses them — the
   * dominant I/O cost during boot (3 calls in boot-sequence) and tray menu
   * refreshes (called on every menu rebuild).
   */
  private entriesCache: ThemeEntry[] | null = null;

  constructor(private readonly root: string) {}

  async initialize(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
    setCoverDir(path.join(this.root, '..', 'theme-covers'));
    // P2-9/N3: Clean up any *.installing-<timestamp> leftover files from a
    // previous install that crashed mid-way between copyFile/writeFile and
    // rename. Without this, every interrupted install leaks a package-sized
    // orphan file in userData/themes — a multi-GB file would never be GC'd.
    try {
      const entries = await fs.readdir(this.root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!entry.name.includes('.installing-')) continue;
        await fs.unlink(path.join(this.root, entry.name)).catch(() => undefined);
      }
    } catch {
      // Best-effort only — a failed orphan cleanup should never block boot.
    }
    await this.migrateLegacyDirectories();
  }

  /** Invalidate the entries cache. Called after any filesystem mutation
   *  that changes the set or content of .agentskin-theme files. */
  private invalidateEntriesCache(): void {
    this.entriesCache = null;
  }

  /**
   * Pre-rewrite installs stored unpacked legacy codex-theme directories
   * (manifest.json + theme.css + art). Convert each one to an agentskin-theme
   * package once; failures keep the directory untouched.
   */
  private async migrateLegacyDirectories(): Promise<void> {
    const entries = await fs.readdir(this.root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(this.root, entry.name);
      try {
        const manifestRaw = await fs.readFile(path.join(directory, 'manifest.json'), 'utf8');
        const manifest = JSON.parse(manifestRaw) as {
          id?: unknown;
          css?: unknown;
          art?: unknown;
        };
        // R6-8: 显式字符串类型检查。原实现仅 `as` 断言，损坏的 manifest 会
        // 导致 `readFile(path.join(directory, manifest.css))` 抛 TypeError。
        if (typeof manifest.id !== 'string' || !manifest.id) continue;
        if (typeof manifest.css !== 'string' || !manifest.css) continue;
        const css = await fs.readFile(path.join(directory, manifest.css), 'utf8');
        const legacyBundle: Record<string, unknown> = {
          format: 'codex-theme',
          schemaVersion: 1,
          manifest: { ...manifest, id: manifest.id, css: 'theme.css' },
          css,
        };
        if (typeof manifest.art === 'string' && manifest.art) {
          const artPath = path.join(directory, manifest.art);
          const bytes = await fs.readFile(artPath);
          const ext = path.extname(artPath).toLowerCase();
          legacyBundle.art = {
            filename: path.basename(artPath),
            mimeType:
              ext === '.jpg' || ext === '.jpeg'
                ? 'image/jpeg'
                : ext === '.webp'
                  ? 'image/webp'
                  : ext === '.gif'
                    ? 'image/gif'
                    : 'image/png',
            base64: bytes.toString('base64'),
          };
        }
        const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-migrate-'));
        try {
          const legacyFile = path.join(temporary, `${manifest.id}.codex-theme`);
          await fs.writeFile(legacyFile, JSON.stringify(legacyBundle), 'utf8');
          const converted = path.join(temporary, `${manifest.id}${themeExtension}`);
          await convertLegacyTheme(legacyFile, converted, { force: true });
          await this.installFile(converted);
          await fs.rm(directory, { recursive: true, force: true });
          mainInfo('ThemeLibrary', `migrated legacy theme ${manifest.id}`);
        } finally {
          await fs.rm(temporary, { recursive: true, force: true });
        }
      } catch (error) {
        mainWarnFromCatch('ThemeLibrary', error, `legacy migration skipped for ${entry.name}`);
      }
    }
  }

  private packagePath(themeId: string): string {
    if (!isSafeThemeId(themeId)) throw new Error(getMainMessages().manifestInvalidId);
    return path.join(this.root, `${themeId}${themeExtension}`);
  }

  /**
   * Resolve the cached cover file path for a theme id (scheme handler).
   * Populated during catalog builds by `extractCover` in `utils.ts`.
   */
  coverPathFor(id: string): string | null {
    return getCachedCoverPath(id);
  }

  /** Resolve the cached icon file path for a theme id (scheme handler). */
  iconPathFor(id: string): string | null {
    return getCachedIconPath(id);
  }

  async entries(): Promise<ThemeEntry[]> {
    // Fast path: return cached entries if no mutation has occurred since the
    // last scan. This eliminates redundant disk reads during boot (where
    // summaries() is called multiple times) and tray menu refreshes.
    if (this.entriesCache !== null) return this.entriesCache;

    const sortLocale = getMainLocale() === 'en' ? 'en-US' : 'zh-CN';
    const files = await fs.readdir(this.root, { withFileTypes: true }).catch(() => []);
    const themeFiles = files.filter((f) => f.isFile() && f.name.endsWith(themeExtension));

    // Read all theme packages in parallel — the sequential for-loop was the
    // dominant I/O cost when 20+ themes are installed, each requiring a
    // separate disk read + JSON parse of multi-MB base64 payloads.
    const results = await Promise.all(
      themeFiles.map(async (file) => {
        const filePath = path.join(this.root, file.name);
        try {
          return { bundle: await readTheme(filePath), filePath };
        } catch (error) {
          mainWarnFromCatch('ThemeLibrary', error, `skipped invalid package ${file.name}`);
          return null;
        }
      }),
    );
    const valid = results.filter((r): r is ThemeEntry => r !== null);
    this.entriesCache = valid.sort((a, b) =>
      a.bundle.theme.displayName.localeCompare(b.bundle.theme.displayName, sortLocale),
    );
    return this.entriesCache;
  }

  async summaries(): Promise<InstalledTheme[]> {
    return (await this.entries()).map(toInstalledTheme);
  }

  async find(themeId: string): Promise<ThemeEntry> {
    const filePath = this.packagePath(themeId);
    try {
      return { bundle: await readTheme(filePath), filePath };
    } catch {
      throw new Error(getMainMessages().themeNotFound(themeId));
    }
  }

  /** Validate and copy a .agentskin-theme file into the library (atomic replace). */
  async installFile(sourcePath: string): Promise<InstalledTheme> {
    // P1 audit #5: stat before readTheme so we reject an oversized / hostile
    // package before readFile ever allocates a Buffer of the file's size.
    // Without this guard a multi-GB file would OOM the main process at the
    // JSON.parse step that readTheme performs internally.
    let size = 0;
    try {
      size = (await fs.stat(sourcePath)).size;
    } catch {
      throw new Error(getMainMessages().invalidPackage);
    }
    if (size > MAX_THEME_PACKAGE_BYTES) {
      throw new Error(getMainMessages().packageTooLarge(MAX_THEME_PACKAGE_BYTES / (1024 * 1024)));
    }
    const bundle = await readTheme(sourcePath);
    const destination = this.packagePath(bundle.theme.id);
    const temporary = `${destination}.installing-${Date.now()}`;
    // P2-9/N3: Wrap the copy+rename in try/finally (with success flag) so any
    // throw (copy failure, disk full, process killed during rename, etc.)
    // always removes the half-copied temporary, instead of leaking it until
    // the next initialize() sweep. initialize() above covers process-kill
    // scenarios that don't make it to this finally clause.
    let renameSucceeded = false;
    try {
      await fs.copyFile(sourcePath, temporary);
      await fs.rename(temporary, destination);
      renameSucceeded = true;
    } finally {
      if (!renameSucceeded) {
        await fs.unlink(temporary).catch(() => undefined);
      }
    }
    this.invalidateEntriesCache();
    return toInstalledTheme({ bundle, filePath: destination });
  }

  /** Install from in-memory bytes (marketplace downloads). */
  async installBytes(bytes: Buffer, _suggestedId: string): Promise<InstalledTheme> {
    // P1 audit #5: same guard as installFile — the bytes are already in memory
    // (downloaded from the marketplace) so the OOM risk is the JSON.parse
    // step, which allocates a string equal to bytes.length before validating.
    if (bytes.length > MAX_THEME_PACKAGE_BYTES) {
      throw new Error(getMainMessages().packageTooLarge(MAX_THEME_PACKAGE_BYTES / (1024 * 1024)));
    }
    // R6-9: JSON.parse 移到 try/catch 内。非 UTF-8 或非法 JSON 时向调用方抛出
    // 语义化错误而非 SyntaxError，避免未捕获异常导致调用链崩溃。
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new Error(getMainMessages().invalidPackage);
    }
    const bundle = validateTheme(parsed);
    if (!isSafeThemeId(bundle.theme.id)) throw new Error(getMainMessages().manifestInvalidId);
    const destination = this.packagePath(bundle.theme.id);
    const temporary = `${destination}.installing-${Date.now()}`;
    // P2-9/N3: Same pattern as installFile — always clean the temporary file
    // on any failure path (writeFile/rename throw, or process death covered
    // by initialize() sweep on restart).
    let renameSucceeded = false;
    try {
      await fs.writeFile(temporary, bytes);
      await fs.rename(temporary, destination);
      renameSucceeded = true;
    } finally {
      if (!renameSucceeded) {
        await fs.unlink(temporary).catch(() => undefined);
      }
    }
    this.invalidateEntriesCache();
    return toInstalledTheme({ bundle, filePath: destination });
  }

  /**
   * Run `use` with a path to a valid agentskin-theme file. Legacy .codex-theme
   * files are converted into a temp file that lives for the duration of `use`.
   */
  private async withNormalizedPackage<T>(
    sourcePath: string,
    use: (packagePath: string) => Promise<T>,
  ): Promise<T> {
    if (sourcePath.endsWith(agentThemeExtension) || sourcePath.endsWith(themeExtension)) {
      return use(sourcePath);
    }
    if (sourcePath.endsWith(legacyThemeExtension)) {
      const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-convert-'));
      try {
        const converted = path.join(temporary, `converted${themeExtension}`);
        await convertLegacyTheme(sourcePath, converted, { force: true });
        return await use(converted);
      } finally {
        await fs.rm(temporary, { recursive: true, force: true });
      }
    }
    throw new Error(getMainMessages().invalidPackage);
  }

  /**
   * Import a user-picked package. Legacy .codex-theme files are converted to
   * the agentskin-theme format on the way in.
   */
  async importPackage(sourcePath: string): Promise<InstalledTheme> {
    return this.withNormalizedPackage(sourcePath, (packagePath) => this.installFile(packagePath));
  }

  /**
   * Validate a package and report what importing it would do, without touching
   * the library. Used by file-open auto-import to decide between installing
   * directly and asking the user to confirm a replacement.
   */
  async inspectPackage(sourcePath: string): Promise<PackageInspection> {
    return this.withNormalizedPackage(sourcePath, async (packagePath) => {
      const bundle = await readTheme(packagePath);
      if (!isSafeThemeId(bundle.theme.id)) throw new Error(getMainMessages().manifestInvalidId);
      const incoming = toInstalledTheme({ bundle, filePath: sourcePath });
      let existing: InstalledTheme | null = null;
      try {
        existing = toInstalledTheme(await this.find(bundle.theme.id));
      } catch {
        existing = null;
      }
      return { incoming, existing };
    });
  }

  async exportPackage(themeId: string, destination: string): Promise<void> {
    const entry = await this.find(themeId);
    await fs.copyFile(entry.filePath, destination);
  }

  async delete(themeId: string): Promise<void> {
    const filePath = this.packagePath(themeId);
    try {
      await fs.rm(filePath, { force: true });
    } catch (error) {
      // Log but don't throw - the file may have been deleted by another process
      mainWarnFromCatch('ThemeLibrary', error, `failed to delete theme package ${themeId}`);
    }
    this.invalidateEntriesCache();
    // Drop the cached cover so a re-added theme with the same id refreshes.
    clearCoverCache(themeId);
  }
}

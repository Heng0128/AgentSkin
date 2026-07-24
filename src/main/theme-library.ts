// SPDX-License-Identifier: MPL-2.0

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
} from '../legacy/agentskin-core-runtime';
import type { ThemeBundle } from '../legacy/agentskin-core-runtime';
import { getMainLocale, getMainMessages } from '../shared/i18n';
import { isAgentId, type AgentId, type InstalledTheme } from '../shared/types';
import { isSafeThemeId } from '../shared/theme-id';
import { mainWarn, mainInfo, mainWarnFromCatch } from './logger';
import type { ThemeLibraryApi } from './services/contracts';

export interface ThemeEntry {
  bundle: ThemeBundle;
  filePath: string;
}

export interface PackageInspection {
  incoming: InstalledTheme;
  /** The installed theme this import would replace, when the id is taken. */
  existing: InstalledTheme | null;
}

function coverDataUrl(bundle: ThemeBundle): string | null {
  const image = bundle.assets?.images?.hero ?? bundle.assets?.art ?? null;
  if (!image?.base64) return null;
  return `data:${image.mimeType || 'image/png'};base64,${image.base64}`;
}

function iconDataUrl(bundle: ThemeBundle): string | null {
  const image = bundle.assets?.images?.icon ?? null;
  if (!image?.base64) return null;
  return `data:${image.mimeType || 'image/png'};base64,${image.base64}`;
}

function supportedAgents(bundle: ThemeBundle): AgentId[] {
  return Object.keys(bundle.targets).filter(isAgentId);
}

/**
 * Target keys that are NOT current AgentIds �?e.g. legacy "codex" themes.
 * These are preserved (not silently dropped) so the migration layer and UI
 * can surface them.
 */
function legacyTargets(bundle: ThemeBundle): string[] {
  return Object.keys(bundle.targets).filter((key) => !isAgentId(key));
}

/**
 * Extract semantic color tokens from a ThemeBundle's target CSS.
 */
function extractColors(bundle: ThemeBundle): Record<string, string> | undefined {
  const cssEntries = Object.values(bundle.targets);
  const allCss = cssEntries.map((t) => typeof t.css === 'string' ? t.css : '').join('\n');
  if (!allCss) return undefined;
  const colorMap: Record<string, string> = {};
  const tokenRegex = /--agentskin-(\w[\w-]*):\s*([^;]+);/g;
  let match;
  while ((match = tokenRegex.exec(allCss)) !== null) {
    const [, token, value] = match;
    const normalized = token.replace(/-/g, '');
    colorMap[normalized] = value.trim();
  }
  return Object.keys(colorMap).length > 0 ? colorMap : undefined;
}

/**
 * Infer dark/light mode from a theme's color palette using perceived
 * luminance (Rec. 709 weights). Threshold 0.4 �?dark. Returns null if no
 * usable background color is found.
 *
 * This is the single source of truth for mode inference �?both the catalog
 * (detectMode below) and the engine (agent-engine-service) call it, so the
 * two layers can never disagree on whether a given background is dark or
 * light.
 */
export function inferModeFromColors(colors?: Record<string, string>): 'dark' | 'light' | null {
  if (!colors) return null;
  const bg = colors.background ?? colors.bg ?? colors['--background'];
  if (!bg || typeof bg !== 'string') return null;
  // Parse hex (#rgb / #rrggbb) or rgb()/rgba().
  const hex = bg.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  let r = 0, g = 0, b = 0;
  if (hex) {
    const h = hex[1];
    if (h.length === 3) {
      r = parseInt(h[0] + h[0], 16);
      g = parseInt(h[1] + h[1], 16);
      b = parseInt(h[2] + h[2], 16);
    } else {
      r = parseInt(h.slice(0, 2), 16);
      g = parseInt(h.slice(2, 4), 16);
      b = parseInt(h.slice(4, 6), 16);
    }
  } else {
    const rgb = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!rgb) return null;
    r = parseInt(rgb[1], 10);
    g = parseInt(rgb[2], 10);
    b = parseInt(rgb[3], 10);
  }
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance < 0.4 ? 'dark' : 'light';
}

/**
 * Detect the color mode from semantic tokens. Delegates to the shared
 * {@link inferModeFromColors} so the catalog and engine always agree.
 */
function detectMode(bundle: ThemeBundle): 'dark' | 'light' | 'auto' | undefined {
  return inferModeFromColors(extractColors(bundle)) ?? undefined;
}

export function toInstalledTheme(entry: ThemeEntry): InstalledTheme {
  const { bundle } = entry;
  const copy = (bundle.theme.copy ?? null) as Record<string, unknown> | null;
  const themeMeta = bundle.theme as unknown as Record<string, unknown>;
  // Display metadata lives in theme.copy (engine-safe free-form record).
  // Fall back to legacy top-level theme fields for bundles from older
  // installers / imported .agentskin-theme packages.
  const pick = (key: string): unknown => {
    if (copy && key in copy) return copy[key];
    return themeMeta[key];
  };

  const tagline = typeof pick('tagline') === 'string' ? (pick('tagline') as string) : null;

  // Author: string, or { name, url } object, or absent.
  const authorRaw = pick('author');
  let author: string | undefined;
  if (typeof authorRaw === 'string') author = authorRaw;
  else if (authorRaw && typeof authorRaw === 'object' && 'name' in authorRaw) {
    const name = (authorRaw as { name?: unknown }).name;
    author = typeof name === 'string' ? name : undefined;
  }

  const category = typeof pick('category') === 'string' ? (pick('category') as string) : undefined;
  const tags = Array.isArray(pick('tags')) ? (pick('tags') as string[]) : undefined;
  const license = typeof pick('license') === 'string' ? (pick('license') as string) : undefined;
  const unofficial = typeof pick('unofficial') === 'boolean' ? (pick('unofficial') as boolean) : undefined;
  const mode = typeof pick('mode') === 'string'
    ? (pick('mode') as 'dark' | 'light' | 'auto')
    : undefined;

  // Prefer an explicit supportedAgents list (the agent ids this theme
  // targets); else derive from target keys.
  const copySupported = Array.isArray(pick('supportedAgents'))
    ? (pick('supportedAgents') as unknown[]).filter(
        (x): x is AgentId => typeof x === 'string' && isAgentId(x),
      )
    : null;
  const supported = copySupported && copySupported.length ? copySupported : supportedAgents(bundle);

  // Prefer colors extracted from embedded CSS; fall back to manifest colors.
  const colors = extractColors(bundle)
    ?? (copy?.colors && typeof copy.colors === 'object' ? (copy.colors as Record<string, string>) : undefined);

  return {
    id: bundle.theme.id,
    displayName: bundle.theme.displayName,
    version: bundle.theme.version,
    author,
    category,
    tags,
    license,
    unofficial,
    supportedAgents: supported,
    legacyTargets: legacyTargets(bundle),
    coverDataUrl: coverDataUrl(bundle),
    tagline,
    iconDataUrl: iconDataUrl(bundle),
    icon: iconDataUrl(bundle),
    colors,
    mode: mode ?? detectMode(bundle),
    contentHash: typeof pick('contentHash') === 'string' ? (pick('contentHash') as string) : undefined,
    wallpaper: extractWallpaper(pick('wallpaper')),
  };
}

/** Type-guard the free-form wallpaper config from theme.copy into a safe shape.
 *  Requires at least one of workshopId / video to be present. */
function extractWallpaper(raw: unknown): InstalledTheme['wallpaper'] {
  if (!raw || typeof raw !== 'object') return null;
  const wp = raw as Record<string, unknown>;
  const workshopId = typeof wp.workshopId === 'string' ? wp.workshopId : undefined;
  const video = typeof wp.video === 'string' ? wp.video : undefined;
  if (!workshopId && !video) return null;
  return {
    workshopId: workshopId || undefined,
    video: video || undefined,
    poster: typeof wp.poster === 'string' ? wp.poster : undefined,
    speed: typeof wp.speed === 'number' ? wp.speed : undefined,
    loop: typeof wp.loop === 'boolean' ? wp.loop : undefined,
    scrimOpacity: typeof wp.scrimOpacity === 'number' ? wp.scrimOpacity : undefined,
  };
}

/**
 * Installed themes are stored as raw `.agentskin-theme` package files under
 * userData/themes. Reads always revalidate through the legacy core runtime,
 * which wraps @agentskin/core's theme tooling.
 */
export class ThemeLibrary implements ThemeLibraryApi {
  constructor(private readonly root: string) {}

  async initialize(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
    await this.migrateLegacyDirectories();
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
          id?: string; css?: string; art?: string | null;
        };
        if (!manifest.id || !manifest.css) continue;
        const css = await fs.readFile(path.join(directory, manifest.css), 'utf8');
        const legacyBundle: Record<string, unknown> = {
          format: 'codex-theme',
          schemaVersion: 1,
          manifest: { ...manifest, css: 'theme.css' },
          css,
        };
        if (manifest.art) {
          const artPath = path.join(directory, manifest.art);
          const bytes = await fs.readFile(artPath);
          const ext = path.extname(artPath).toLowerCase();
          legacyBundle.art = {
            filename: path.basename(artPath),
            mimeType: ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
              : ext === '.webp' ? 'image/webp'
                : ext === '.gif' ? 'image/gif' : 'image/png',
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

  async entries(): Promise<ThemeEntry[]> {
    const sortLocale = getMainLocale() === 'en' ? 'en-US' : 'zh-CN';
    const files = await fs.readdir(this.root, { withFileTypes: true }).catch(() => []);
    const result: ThemeEntry[] = [];
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(themeExtension)) continue;
      const filePath = path.join(this.root, file.name);
      try {
        result.push({ bundle: await readTheme(filePath), filePath });
      } catch (error) {
        mainWarnFromCatch('ThemeLibrary', error, `skipped invalid package ${file.name}`);
      }
    }
    return result.sort((a, b) =>
      a.bundle.theme.displayName.localeCompare(b.bundle.theme.displayName, sortLocale));
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
    const bundle = await readTheme(sourcePath);
    const destination = this.packagePath(bundle.theme.id);
    const temporary = `${destination}.installing-${Date.now()}`;
    await fs.copyFile(sourcePath, temporary);
    await fs.rename(temporary, destination);
    return toInstalledTheme({ bundle, filePath: destination });
  }

  /** Install from in-memory bytes (marketplace downloads). */
  async installBytes(bytes: Buffer, suggestedId: string): Promise<InstalledTheme> {
    const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
    const bundle = validateTheme(parsed);
    if (!isSafeThemeId(bundle.theme.id)) throw new Error(getMainMessages().manifestInvalidId);
    const destination = this.packagePath(bundle.theme.id || suggestedId);
    const temporary = `${destination}.installing-${Date.now()}`;
    await fs.writeFile(temporary, bytes);
    await fs.rename(temporary, destination);
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
    await fs.rm(this.packagePath(themeId), { force: true });
  }
}

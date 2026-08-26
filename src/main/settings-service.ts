// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises';
import { getMainMessages } from '../shared/i18n';
import {
  AGENT_IDS,
  type AgentId,
  type AppOverride,
  type DesktopSettings,
  WALLPAPER_ALIGNMENTS,
  type WallpaperAgentSetting,
  type WallpaperRenderOptions,
  type WallpaperSettings,
} from '../shared/types';
import { writeJsonAtomic } from './fs-utils';
import { isPortInRange } from './ipc/ipc-validators';
import type { SettingsServiceApi } from './services/contracts';

interface PersistedWallpaper {
  enabled?: boolean;
  id?: string | null;
  render?: WallpaperRenderOptions;
  agents?: Partial<
    Record<AgentId, { enabled?: boolean; id?: string | null; render?: WallpaperRenderOptions }>
  >;
}

interface PersistedSettings {
  version: 2;
  apps: Partial<Record<AgentId, Partial<AppOverride>>>;
  wallpaper?: PersistedWallpaper;
  /** Global user-authored CSS injected as the highest-priority theme layer
   *  (custom.css). Never overwritten by theme applies; cleared on restore. */
  customThemeCss?: string;
  /** Live DOM 自动刷新间隔（毫秒），0=不自动刷新。默认 0 */
  liveDomRefreshInterval?: number;
}

/** Upper bound on user custom CSS (256 KB) — generous for a CSS file, small
 *  enough to reject accidental multi-MB pastes from the settings textarea. */
const MAX_CUSTOM_THEME_CSS_CHARS = 256 * 1024;

/** Read the persisted custom CSS; malformed values (non-string, oversized)
 *  are dropped silently so a corrupt settings file never surfaces garbage. */
function normalizeCustomThemeCss(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_CUSTOM_THEME_CSS_CHARS) return undefined;
  return trimmed;
}

/** Read the persisted live DOM refresh interval; non-negative finite integers
 *  are accepted, everything else is dropped (falls through to default 0). */
function normalizeLiveDomRefreshInterval(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
  if (raw < 0 || !Number.isInteger(raw)) return undefined;
  return raw;
}

// R6-10: 运行时验证 apps 字段结构，避免 `as unknown as PersistedSettings` 绕过类型检查。
function isValidPersistedSettingsApps(
  apps: unknown,
): apps is Partial<Record<AgentId, Partial<AppOverride>>> {
  if (!apps || typeof apps !== 'object' || Array.isArray(apps)) return false;
  for (const [key, val] of Object.entries(apps as Record<string, unknown>)) {
    if (!(AGENT_IDS as readonly string[]).includes(key)) return false;
    if (val != null && typeof val !== 'object') return false;
    if (val && typeof val === 'object') {
      const entry = val as Record<string, unknown>;
      if ('appPath' in entry && entry.appPath != null && typeof entry.appPath !== 'string')
        return false;
      if ('port' in entry && entry.port != null && typeof entry.port !== 'number') return false;
    }
  }
  return true;
}

const EMPTY_OVERRIDE: AppOverride = { appPath: null, port: null };

/** Clamp a number into [min, max]; non-finite → undefined (drop the field). */
function clampNum(v: unknown, min: number, max: number): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  return Math.min(max, Math.max(min, v));
}

/** Clamp a boolean-ish value to true/false; anything else → undefined. */
function clampBool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

/**
 * Normalize + clamp a persisted {@link WallpaperRenderOptions} fragment.
 * Every field is optional; malformed values are dropped (fall through to the
 * CDP injector default) rather than crashing or producing out-of-range CSS.
 */
export function normalizeRenderOptions(
  raw: Partial<WallpaperRenderOptions> | undefined | null,
): WallpaperRenderOptions | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: WallpaperRenderOptions = {};
  let any = false;

  const speed = clampNum(raw.speed, 0.25, 2);
  if (speed !== undefined) {
    out.speed = speed;
    any = true;
  }
  const loop = clampBool(raw.loop);
  if (loop !== undefined) {
    out.loop = loop;
    any = true;
  }
  const scrimOpacity = clampNum(raw.scrimOpacity, 0, 100);
  if (scrimOpacity !== undefined) {
    out.scrimOpacity = scrimOpacity;
    any = true;
  }
  if (
    typeof raw.alignment === 'string' &&
    (WALLPAPER_ALIGNMENTS as readonly string[]).includes(raw.alignment)
  ) {
    out.alignment = raw.alignment as WallpaperRenderOptions['alignment'];
    any = true;
  }
  const positionX = clampNum(raw.positionX, -100, 100);
  if (positionX !== undefined) {
    out.positionX = positionX;
    any = true;
  }
  const positionY = clampNum(raw.positionY, -100, 100);
  if (positionY !== undefined) {
    out.positionY = positionY;
    any = true;
  }
  const flipH = clampBool(raw.flipH);
  if (flipH !== undefined) {
    out.flipH = flipH;
    any = true;
  }
  const flipV = clampBool(raw.flipV);
  if (flipV !== undefined) {
    out.flipV = flipV;
    any = true;
  }
  const parallax = clampNum(raw.parallax, 0, 100);
  if (parallax !== undefined) {
    out.parallax = parallax;
    any = true;
  }
  const brightness = clampNum(raw.brightness, 0, 200);
  if (brightness !== undefined) {
    out.brightness = brightness;
    any = true;
  }
  const contrast = clampNum(raw.contrast, 0, 200);
  if (contrast !== undefined) {
    out.contrast = contrast;
    any = true;
  }
  const saturation = clampNum(raw.saturation, 0, 200);
  if (saturation !== undefined) {
    out.saturation = saturation;
    any = true;
  }
  const hueRotate = clampNum(raw.hueRotate, -180, 180);
  if (hueRotate !== undefined) {
    out.hueRotate = hueRotate;
    any = true;
  }
  const sepia = clampNum(raw.sepia, 0, 100);
  if (sepia !== undefined) {
    out.sepia = sepia;
    any = true;
  }
  const grayscale = clampNum(raw.grayscale, 0, 100);
  if (grayscale !== undefined) {
    out.grayscale = grayscale;
    any = true;
  }
  const blur = clampNum(raw.blur, 0, 50);
  if (blur !== undefined) {
    out.blur = blur;
    any = true;
  }
  if (typeof raw.tint === 'string' && /^#?[0-9a-f]{3,8}$/i.test(raw.tint.trim())) {
    out.tint = raw.tint.trim();
    any = true;
  }
  const audioLevel = clampNum(raw.audioLevel, 0, 100);
  if (audioLevel !== undefined) {
    out.audioLevel = audioLevel;
    any = true;
  }

  return any ? out : undefined;
}

/** Build a full WallpaperAgentSetting from a raw persisted fragment, filling
 *  defaults for missing fields so callers always see a complete object. */
function normalizeAgentWallpaper(
  raw: { enabled?: boolean; id?: string | null; render?: WallpaperRenderOptions } | undefined,
): WallpaperAgentSetting {
  const render = normalizeRenderOptions(raw?.render);
  return {
    enabled: raw?.enabled === true,
    id: typeof raw?.id === 'string' && raw.id ? raw.id : null,
    ...(render ? { render } : {}),
  };
}

/** User-set detection overrides: manual app paths and debug ports (userData/settings.json). */
export class SettingsService implements SettingsServiceApi {
  private data: PersistedSettings = { version: 2, apps: {} };

  constructor(private readonly file: string) {}

  async initialize(): Promise<void> {
    try {
      // TODO: type-guard — 待渐进式加固
      const parsed = JSON.parse(await fs.readFile(this.file, 'utf8')) as {
        version?: number;
        apps?: unknown;
        wallpaper?: { enabled?: boolean; id?: string | null };
      };
      if (parsed?.apps && typeof parsed.apps === 'object') {
        // Migration v1 -> v2: drop all port overrides. The previous version
        // let users (and auto-fill) set ports like 9336/9337/9338, which were
        // stale assumptions about where each agent's CDP endpoint lives.
        // WorkBuddy 5.3.x binds a random port per launch, QoderWork forces
        // port=0, and TRAE SOLO only opens CDP when explicitly launched with
        // --remote-debugging-port. Keeping those overrides caused AgentSkin
        // to trust dead/zombie ports. v2 makes all CDP discovery dynamic;
        // users can still set a port override explicitly if they really need
        // to, but pre-existing overrides are wiped on upgrade.
        if (parsed.version === 1) {
          const migrated: PersistedSettings = {
            version: 2,
            apps: {},
            wallpaper: parsed.wallpaper,
          };
          for (const [appId, entry] of Object.entries(parsed.apps as Record<string, unknown>)) {
            if (entry && typeof entry === 'object') {
              const e = entry as { appPath?: string | null; port?: number | null };
              migrated.apps[appId as AgentId] = { appPath: e.appPath ?? null, port: null };
            }
          }
          this.data = migrated;
          await this.persist();
          return;
        }
        // R6-10: 对 ParsedSettings 做基础运行时验证，避免磁盘 schema 不匹配时
        // `as unknown as PersistedSettings` 双重断言绕过类型检查。
        if (parsed.version === 2 && isValidPersistedSettingsApps(parsed.apps)) {
          this.data = {
            version: 2,
            apps: parsed.apps as Partial<Record<AgentId, Partial<AppOverride>>>,
            wallpaper: parsed.wallpaper,
            customThemeCss: normalizeCustomThemeCss(
              (parsed as { customThemeCss?: unknown }).customThemeCss,
            ),
            liveDomRefreshInterval: normalizeLiveDomRefreshInterval(
              (parsed as { liveDomRefreshInterval?: unknown }).liveDomRefreshInterval,
            ),
          };
        } else if (parsed.version === 2) {
          // Schema 结构异常但版本号匹配 — 走安全降级
          console.warn(
            `[settings] ${this.file} version=2 but apps structure invalid — resetting apps`,
          );
          this.data = { version: 2, apps: {} };
        }
      }
    } catch (error) {
      // Distinguish "file not found" (fresh install) from "file exists but
      // is corrupt" (partial write, disk error). Only warn on the latter so
      // the user knows their settings were silently reset.
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') {
        console.warn(
          `[settings] ${this.file} exists but could not be parsed — resetting to defaults:`,
          error,
        );
      }
    }
  }

  private async persist(): Promise<void> {
    await writeJsonAtomic(this.file, this.data);
  }

  overridesFor(appId: AgentId): AppOverride {
    const entry = this.data.apps[appId];
    return {
      appPath: typeof entry?.appPath === 'string' && entry.appPath ? entry.appPath : null,
      port: isPortInRange(entry?.port) ? entry.port : null,
    };
  }

  wallpaper(): WallpaperSettings {
    const wp = this.data.wallpaper;
    const agents = {} as Record<AgentId, WallpaperAgentSetting>;
    for (const appId of AGENT_IDS) {
      agents[appId] = normalizeAgentWallpaper(wp?.agents?.[appId]);
    }
    const render = normalizeRenderOptions(wp?.render);
    return {
      enabled: wp?.enabled === true,
      id: typeof wp?.id === 'string' && wp.id ? wp.id : null,
      agents,
      ...(render ? { render } : {}),
    };
  }

  /** Read a single agent's wallpaper setting. */
  agentWallpaper(appId: AgentId): WallpaperAgentSetting {
    return normalizeAgentWallpaper(this.data.wallpaper?.agents?.[appId]);
  }

  /** Read the global user-authored theme CSS (empty string when unset). */
  customThemeCss(): string {
    return this.data.customThemeCss ?? '';
  }

  /** Replace the global user-authored theme CSS. Empty string clears it. */
  async setCustomThemeCss(css: string): Promise<void> {
    const normalized = normalizeCustomThemeCss(css);
    this.data.customThemeCss = normalized;
    await this.persist();
  }

  /** Read the live DOM auto-refresh interval (ms). 0 = disabled. */
  liveDomRefreshInterval(): number {
    return this.data.liveDomRefreshInterval ?? 0;
  }

  /** Set the live DOM auto-refresh interval (ms). 0 disables auto-refresh. */
  async setLiveDomRefreshInterval(interval: number): Promise<void> {
    const normalized = normalizeLiveDomRefreshInterval(interval);
    this.data.liveDomRefreshInterval = normalized;
    await this.persist();
  }

  toDto(defaultPorts: Record<AgentId, number>): DesktopSettings {
    const apps = {} as Record<AgentId, AppOverride>;
    for (const appId of AGENT_IDS) apps[appId] = this.overridesFor(appId);
    return {
      apps,
      defaultPorts,
      wallpaper: this.wallpaper(),
      ...(this.data.customThemeCss ? { customThemeCss: this.data.customThemeCss } : {}),
      liveDomRefreshInterval: this.data.liveDomRefreshInterval ?? 0,
    };
  }

  async setAppPath(appId: AgentId, appPath: string | null): Promise<void> {
    if (appPath) {
      // Validate the path exists before persisting — a stale/mistyped path
      // would silently fail at the next CDP discovery with no user feedback.
      try {
        await fs.access(appPath);
      } catch {
        throw new Error(`应用路径不存在或无法访问: "${appPath}"`);
      }
    }
    this.data.apps[appId] = { ...EMPTY_OVERRIDE, ...this.data.apps[appId], appPath };
    await this.persist();
  }

  async setAppPort(appId: AgentId, port: number | null): Promise<void> {
    if (port !== null && !isPortInRange(port)) throw new Error(getMainMessages().invalidPort);
    this.data.apps[appId] = { ...EMPTY_OVERRIDE, ...this.data.apps[appId], port };
    await this.persist();
  }

  async setWallpaper(
    wallpaper: Pick<WallpaperSettings, 'enabled' | 'id' | 'render'>,
  ): Promise<void> {
    const render = normalizeRenderOptions(wallpaper.render);
    this.data.wallpaper = {
      enabled: wallpaper.enabled === true,
      id: typeof wallpaper.id === 'string' && wallpaper.id ? wallpaper.id : null,
      agents: this.data.wallpaper?.agents ?? {},
      ...(render ? { render } : {}),
    };
    await this.persist();
  }

  /** Persist a per-agent wallpaper setting. */
  async setAgentWallpaper(appId: AgentId, setting: WallpaperAgentSetting): Promise<void> {
    if (!this.data.wallpaper) this.data.wallpaper = {};
    if (!this.data.wallpaper.agents) this.data.wallpaper.agents = {};
    const render = normalizeRenderOptions(setting.render);
    this.data.wallpaper.agents[appId] = {
      enabled: setting.enabled === true,
      id: typeof setting.id === 'string' && setting.id ? setting.id : null,
      ...(render ? { render } : {}),
    };
    await this.persist();
  }
}

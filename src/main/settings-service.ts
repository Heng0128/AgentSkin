// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises';
import { AGENT_IDS, type AgentId, type AppOverride, type DesktopSettings, type WallpaperAgentSetting, type WallpaperSettings } from '../shared/types';
import { writeJsonAtomic } from './fs-utils';
import type { SettingsServiceApi } from './services/contracts';

interface PersistedWallpaper {
  enabled?: boolean;
  id?: string | null;
  agents?: Partial<Record<AgentId, { enabled?: boolean; id?: string | null }>>;
}

interface PersistedSettings {
  version: 2;
  apps: Partial<Record<AgentId, Partial<AppOverride>>>;
  wallpaper?: PersistedWallpaper;
}

const EMPTY_OVERRIDE: AppOverride = { appPath: null, port: null };

function isValidPort(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1024 && (value as number) <= 65535;
}

/** Build a full WallpaperAgentSetting from a raw persisted fragment, filling
 *  defaults for missing fields so callers always see a complete object. */
function normalizeAgentWallpaper(raw: { enabled?: boolean; id?: string | null } | undefined): WallpaperAgentSetting {
  return {
    enabled: raw?.enabled === true,
    id: typeof raw?.id === 'string' && raw.id ? raw.id : null,
  };
}

/** User-set detection overrides: manual app paths and debug ports (userData/settings.json). */
export class SettingsService implements SettingsServiceApi {
  private data: PersistedSettings = { version: 2, apps: {} };

  constructor(private readonly file: string) {}

  async initialize(): Promise<void> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, 'utf8')) as { version?: number; apps?: unknown; wallpaper?: { enabled?: boolean; id?: string | null } };
      if (parsed && parsed.apps && typeof parsed.apps === 'object') {
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
        if (parsed.version === 2) {
          this.data = parsed as unknown as PersistedSettings;
        }
      }
    } catch {
      // Fresh install — defaults apply.
    }
  }

  private async persist(): Promise<void> {
    await writeJsonAtomic(this.file, this.data);
  }

  overridesFor(appId: AgentId): AppOverride {
    const entry = this.data.apps[appId];
    return {
      appPath: typeof entry?.appPath === 'string' && entry.appPath ? entry.appPath : null,
      port: isValidPort(entry?.port) ? entry.port : null,
    };
  }

  wallpaper(): WallpaperSettings {
    const wp = this.data.wallpaper;
    const agents = {} as Record<AgentId, WallpaperAgentSetting>;
    for (const appId of AGENT_IDS) {
      agents[appId] = normalizeAgentWallpaper(wp?.agents?.[appId]);
    }
    return {
      enabled: wp?.enabled === true,
      id: typeof wp?.id === 'string' && wp.id ? wp.id : null,
      agents,
    };
  }

  /** Read a single agent's wallpaper setting. */
  agentWallpaper(appId: AgentId): WallpaperAgentSetting {
    return normalizeAgentWallpaper(this.data.wallpaper?.agents?.[appId]);
  }

  toDto(defaultPorts: Record<AgentId, number>): DesktopSettings {
    const apps = {} as Record<AgentId, AppOverride>;
    for (const appId of AGENT_IDS) apps[appId] = this.overridesFor(appId);
    return { apps, defaultPorts, wallpaper: this.wallpaper() };
  }

  async setAppPath(appId: AgentId, appPath: string | null): Promise<void> {
    this.data.apps[appId] = { ...EMPTY_OVERRIDE, ...this.data.apps[appId], appPath };
    await this.persist();
  }

  async setAppPort(appId: AgentId, port: number | null): Promise<void> {
    if (port !== null && !isValidPort(port)) throw new Error('INVALID_PORT');
    this.data.apps[appId] = { ...EMPTY_OVERRIDE, ...this.data.apps[appId], port };
    await this.persist();
  }

  async setWallpaper(wallpaper: Pick<WallpaperSettings, 'enabled' | 'id'>): Promise<void> {
    this.data.wallpaper = {
      enabled: wallpaper.enabled === true,
      id: typeof wallpaper.id === 'string' && wallpaper.id ? wallpaper.id : null,
      agents: this.data.wallpaper?.agents ?? {},
    };
    await this.persist();
  }

  /** Persist a per-agent wallpaper setting. */
  async setAgentWallpaper(appId: AgentId, setting: WallpaperAgentSetting): Promise<void> {
    if (!this.data.wallpaper) this.data.wallpaper = {};
    if (!this.data.wallpaper.agents) this.data.wallpaper.agents = {};
    this.data.wallpaper.agents[appId] = {
      enabled: setting.enabled === true,
      id: typeof setting.id === 'string' && setting.id ? setting.id : null,
    };
    await this.persist();
  }
}

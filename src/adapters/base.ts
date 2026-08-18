// SPDX-License-Identifier: MPL-2.0

/**
 * # ApplicationAdapter
 *
 * An ApplicationAdapter is AgentSkin's identity + delegation layer for a
 * target application (AI agent, IDE, or desktop app). It knows WHO the app
 * is and HOW to reach it, but it does NOT reimplement theme execution —
 * every apply/restore/detect call delegates to the legacy core runtime,
 * which in turn calls @agentskin/engine.
 *
 * ## What an adapter is responsible for
 *
 *   1. Application identity (id, name, type, tier)
 *   2. Mapping to the @agentskin/engine adapter that actually knows how to
 *      detect and skin this app (via `coreId`)
 *   3. Delegating detect / apply / restore to the runtime
 *
 * ## What an adapter is NOT responsible for
 *
 *   - Theme parsing or validation (runtime + theme-library own this)
 *   - CDP protocol details (core owns this)
 *   - Host-settings transactions (core owns this)
 *   - State persistence (agent-engine-service owns this)
 *
 * ## Tier
 *
 *   - `active`: backed by a real @agentskin/engine adapter. Fully functional.
 *   - `experimental`: registered for discovery but NOT yet wired to core.
 *     Calling apply/restore/detect throws AGENTSKIN_EXPERIMENTAL_ADAPTER so
 *     callers get an honest error instead of a silent no-op.
 */

import type {
  ApplyThemeResult,
  CdpTarget,
  DiscoveredApp,
  ResolvedThemeTarget,
  RestoreThemeResult,
  ThemeBundle,
} from '../legacy/agentskin-core-runtime';
import {
  discoverApplication,
  findDebugTargets,
  findRunningProcesses,
  getCoreAdapter,
  resolveDebugPortsFor,
  resolveThemeTargetFor,
  applyTheme as runtimeApplyTheme,
  restoreTheme as runtimeRestoreTheme,
} from '../legacy/agentskin-core-runtime';

export type ApplicationType = 'agent' | 'ide' | 'desktop';
export type AdapterTier = 'active' | 'experimental';

/**
 * Hints that let AgentSkin detect an installed agent on Windows without
 * modifying @agentskin/engine. Each adapter declares its own candidates; the
 * generic detector in `src/main/install-detection.ts` consumes them.
 */
export interface InstallHints {
  /** Install directory names under Program Files / AppData Local Programs. */
  dirNames: string[];
  /** Exact executable names to look for inside the install dir. */
  exeNames: string[];
  /** Substrings matched against Uninstall DisplayName (registry). */
  registryNames: string[];
  /**
   * MSIX (Appx) package name prefixes to match via `Get-AppxPackage`. MSIX
   * apps do NOT write to the traditional Uninstall registry, so they need a
   * dedicated probe (e.g. ChatGPT's Windows build ships as `OpenAI.Codex`).
   */
  msixPackageNames?: string[];
}

export interface ApplyThemeOptions {
  port?: number;
  /** Launch the app when no CDP target is reachable. */
  launch?: boolean;
  /** Manual install location override (mainly Windows). */
  appPath?: string | null;
  restartExisting?: boolean;
  timeoutMs?: number;
}

/**
 * Identity + delegation contract for a skinnable application.
 *
 * `detect` / `getPath` / `applyTheme` / `restoreTheme` match the V3 control-
 * layer spec. The remaining methods (`discover`, `findTargets`, ...) are the
 * support surface that agent-engine-service needs for status and port
 * resolution; they are part of the contract so the service never has to call
 * the runtime directly.
 */
export interface ApplicationAdapter {
  // --- Identity ---
  readonly id: string;
  readonly name: string;
  readonly type: ApplicationType;
  readonly tier: AdapterTier;
  /**
   * The @agentskin/engine adapter id this application maps to. Empty string for
   * experimental adapters that are not yet backed by core.
   */
  readonly coreId: string;

  /**
   * AgentSkin-side install detection hints (Windows). Optional — adapters
   * that declare it enable robust path/registry detection; adapters that
   * omit it rely solely on @agentskin/engine's discovery.
   */
  readonly installHints?: InstallHints;

  // --- Spec surface ---
  detect(platform: string, appPath?: string | null): Promise<boolean>;
  getPath(platform: string, appPath?: string | null): Promise<string | null>;
  applyTheme(bundle: ThemeBundle, options?: ApplyThemeOptions): Promise<ApplyThemeResult>;
  restoreTheme(port: number): Promise<RestoreThemeResult>;

  // --- Support surface (used by agent-engine-service) ---
  discover(platform: string, appPath?: string | null): Promise<DiscoveredApp | null>;
  findTargets(port: number, timeoutMs?: number): Promise<CdpTarget[]>;
  findRunningPids(platform: string, executable?: string | null): Promise<number[]>;
  resolveDebugPorts(platform: string): Promise<number[]>;
  defaultPort(): number;
  displayName(): string;

  /**
   * 主 renderer 语义锚点（可选，RFC A2 P1）。透传 @agentskin/engine 适配器
   * 的 `rendererHints`，用于在多兼容 page target 间稳定判定主 renderer。
   * 缺省返回 undefined（无适配级声明，调用方退化为现状）。
   */
  rendererHints(): unknown;
}

/**
 * Error thrown when an experimental adapter (no core backing) is asked to do
 * real work. The `code` field lets callers distinguish this from core errors.
 */
export class ExperimentalAdapterError extends Error {
  readonly code = 'AGENTSKIN_EXPERIMENTAL_ADAPTER';
  constructor(adapterId: string) {
    super(`Adapter "${adapterId}" is experimental and not yet backed by @agentskin/engine.`);
    this.name = 'ExperimentalAdapterError';
  }
}

/**
 * Shared base for all concrete adapters. Subclasses only declare their
 * identity fields (id / name / type / tier / coreId); every behaviour method
 * is centralised here so it always routes through the runtime.
 */
export abstract class BaseApplicationAdapter implements ApplicationAdapter {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly type: ApplicationType;
  abstract readonly tier: AdapterTier;
  abstract readonly coreId: string;

  /** Optional AgentSkin-side install detection hints. */
  readonly installHints?: InstallHints;

  /**
   * Returns the core adapter id, throwing if this adapter is experimental
   * (no core backing). Every method that needs core goes through this guard.
   */
  protected requireCore(): string {
    if (!this.coreId) throw new ExperimentalAdapterError(this.id);
    return this.coreId;
  }

  async discover(platform: string, appPath?: string | null): Promise<DiscoveredApp | null> {
    return discoverApplication(this.requireCore(), platform, appPath);
  }

  async detect(platform: string, appPath?: string | null): Promise<boolean> {
    try {
      return (await this.discover(platform, appPath)) !== null;
    } catch (error) {
      // Experimental adapters throw here; discovery failures are "not installed".
      if (error instanceof ExperimentalAdapterError) throw error;
      return false;
    }
  }

  async getPath(platform: string, appPath?: string | null): Promise<string | null> {
    const found = await this.discover(platform, appPath).catch((error) => {
      if (error instanceof ExperimentalAdapterError) throw error;
      return null;
    });
    return found?.executable ?? found?.appPath ?? null;
  }

  async applyTheme(bundle: ThemeBundle, options?: ApplyThemeOptions): Promise<ApplyThemeResult> {
    const coreId = this.requireCore();
    const targetTheme: ResolvedThemeTarget = resolveThemeTargetFor(bundle, coreId);
    return runtimeApplyTheme({
      coreId,
      targetTheme,
      port: options?.port,
      launch: options?.launch,
      appPath: options?.appPath,
      restartExisting: options?.restartExisting,
      timeoutMs: options?.timeoutMs,
    });
  }

  async restoreTheme(port: number): Promise<RestoreThemeResult> {
    return runtimeRestoreTheme({ coreId: this.requireCore(), port });
  }

  async findTargets(port: number, timeoutMs?: number): Promise<CdpTarget[]> {
    return findDebugTargets(this.requireCore(), port, timeoutMs);
  }

  async findRunningPids(platform: string, executable?: string | null): Promise<number[]> {
    return findRunningProcesses(this.requireCore(), platform, executable);
  }

  async resolveDebugPorts(platform: string): Promise<number[]> {
    return resolveDebugPortsFor(this.requireCore(), platform);
  }

  defaultPort(): number {
    return getCoreAdapter(this.requireCore()).defaultPort;
  }

  displayName(): string {
    return getCoreAdapter(this.requireCore()).displayName;
  }

  /** 透传 core 适配器的 rendererHints（RFC A2 P1）。无 core 支持时返回 undefined。 */
  rendererHints(): unknown {
    try {
      return getCoreAdapter(this.requireCore()).rendererHints;
    } catch {
      return undefined;
    }
  }
}

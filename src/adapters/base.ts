// SPDX-License-Identifier: MPL-2.0

/**
 * # ApplicationAdapter
 *
 * An ApplicationAdapter is AgentSkin's identity + delegation layer for a
 * target application (AI agent, IDE, or desktop app). It knows WHO the app
 * is and HOW to reach it, but it does NOT reimplement theme execution —
 * apply/restore are preflight-only stubs since 2026-09-02; the real
 * injection runs through the V3 engine-strategy
 * (src/main/cdp/injection/engine-strategy.ts → orchestrator).
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
  RestoreThemeResult,
  ThemeBundle,
} from '../legacy/agentskin-core-runtime';
import {
  discoverApplication,
  findDebugTargets,
  findRunningProcesses,
  getCoreAdapter,
  resolveDebugPortsFor,
} from '../legacy/agentskin-core-runtime';
import type { RendererHints } from '../main/cdp/renderer-tools';
import type { WindowMatcher } from '../shared/types/window-matcher';

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
  /**
   * Application bundle name used for macOS detection. When set on a macOS
   * platform, the detector scans `/Applications/<appName>.app` and
   * `~/Applications/<appName>.app` for the app bundle.
   */
  appName?: string;
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
  rendererHints(): RendererHints | undefined;

  /**
   * 多窗口 matcher 声明（可选，P0-2 增强多窗口注入器）。
   *
   * 返回该应用所有已知窗口角色的 matcher 列表。watcher 用这些声明来匹配
   * 新创建的 CDP target 并自动注入主题。缺省返回空数组 —— 适配器不声明
   * 就不参与多窗口自动注入，保持现有单窗口行为零回归。
   *
   * 实现类通常以 `override readonly windowHints: WindowMatcher[] = [...]`
   * 的方式在实例级别声明，此方法仅做透传。
   */
  windowMatchers(): WindowMatcher[];
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
   * Multi-window matcher declarations (P0-2).
   * Adapters that need multi-window auto-inject declare a `windowHints` property.
   * The `windowMatchers()` method returns this field, or empty array if not declared.
   */
  // Note: windowHints is declared by derived classes as needed, not in the base class
  // windowHints: ReadonlyArray<WindowMatcher>;

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

  async applyTheme(_bundle: ThemeBundle, _options?: ApplyThemeOptions): Promise<ApplyThemeResult> {
    // 2026-09-02 RFC: 双引擎收敛 — V2 (@agentskin/engine) 注入路径已移除。
    // 注入统一由 theme-apply-flow.ts → hardening → V3 engine-strategy 完成。
    // 此 stub 仅维持接口契约，供调用方检查 adapter 是否支持 apply。
    return { status: 'preflight-only' } as unknown as ApplyThemeResult;
  }

  async restoreTheme(_port: number): Promise<RestoreThemeResult> {
    // 2026-09-02 RFC: 双引擎收敛 — V2 restore 路径已移除。
    return { status: 'preflight-only' } as unknown as RestoreThemeResult;
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
  rendererHints(): RendererHints | undefined {
    try {
      return getCoreAdapter(this.requireCore()).rendererHints as RendererHints | undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * 多窗口 matcher 透传（P0-2）。
   * 子类通过 `override readonly windowHints: WindowMatcher[] = [...]` 声明，
   * 此方法返回该字段；未声明时退化为空数组 — 保持现有单窗口行为零回归。
   */
  windowMatchers(): WindowMatcher[] {
    // Use type-safe access to windowHints (may not exist on all adapters)
    const hints = (this as unknown as { windowHints?: ReadonlyArray<WindowMatcher> }).windowHints;
    return hints ? [...hints] : [];
  }
}

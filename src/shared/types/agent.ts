// SPDX-License-Identifier: MPL-2.0

export type Platform = 'darwin' | 'win32' | 'unsupported';

/** Platform-registered target agents — formal products backed by @agentskin/engine. */
export type AgentId = 'workbuddy' | 'qoderwork' | 'traework' | 'doubao' | 'codex' | 'zcode';

/**
 * Experimental agent ids (v1.4: removed from supported, reserved for future).
 * These adapters have been deleted. The type remains for forward compatibility.
 */
export type ExperimentalAgentId = never;

/** All recognized agent ids (formal + experimental). */
export type AnyAgentId = AgentId | ExperimentalAgentId;

/** 14 semantic color tokens used by image-to-theme pipeline and Theme Studio.
 *  Single source of truth — do NOT duplicate this list in renderer code. */
export type ImagePaletteKey =
  | 'accent'
  | 'secondary'
  | 'background'
  | 'foreground'
  | 'muted'
  | 'surface'
  | 'surfaceElevated'
  | 'border'
  | 'codeBackground'
  | 'codeForeground'
  | 'inputBackground'
  | 'buttonBackground'
  | 'buttonForeground'
  | 'focusRing';

/**
 * Canonical product metadata for every recognized agent.
 *
 * This is the SINGLE SOURCE OF TRUTH for display names, official names,
 * regions, and tier classification. All other layers (AgentCatalog,
 * AgentEngineService, APP_META) derive their display strings from here —
 * never maintain parallel name maps.
 */
export interface AgentMeta {
  readonly id: AnyAgentId;
  /** User-facing product name shown in the UI. */
  readonly displayName: string;
  /** Brand / official name (not translated). */
  readonly officialName: string;
  /** Market region for this agent build. */
  readonly region: 'CN' | 'International' | 'Global';
  /** Whether this agent is a formal product or experimental. */
  readonly tier: 'active' | 'experimental';
}

export const AGENT_META: Readonly<Record<AnyAgentId, AgentMeta>> = Object.freeze({
  traework: Object.freeze({
    id: 'traework',
    displayName: 'TRAE Work CN',
    officialName: 'TRAE',
    region: 'CN',
    tier: 'active',
  }),
  qoderwork: Object.freeze({
    id: 'qoderwork',
    displayName: 'QoderWork CN',
    officialName: 'Qoder',
    region: 'CN',
    tier: 'active',
  }),
  workbuddy: Object.freeze({
    id: 'workbuddy',
    displayName: 'WorkBuddy',
    officialName: 'WorkBuddy',
    region: 'Global',
    tier: 'active',
  }),
  doubao: Object.freeze({
    id: 'doubao',
    displayName: '豆包',
    officialName: 'Doubao',
    region: 'CN',
    tier: 'active',
  }),
  codex: Object.freeze({
    id: 'codex',
    displayName: 'OpenAI Codex',
    officialName: 'ChatGPT',
    region: 'Global',
    tier: 'active',
  }),
  zcode: Object.freeze({
    id: 'zcode',
    displayName: 'ZCode',
    officialName: 'ZCode',
    region: 'Global',
    tier: 'active',
  }),
  // v1.4: Experimental adapters removed. Reserved for future support.
});

/** Formal product agents — shown in the main UI, checked for status, listed in settings. */
export const AGENT_IDS: readonly AgentId[] = Object.freeze(
  (Object.values(AGENT_META) as AgentMeta[])
    .filter((m) => m.tier === 'active')
    .map((m) => m.id as AgentId),
);

/** v1.4: Experimental adapters removed. Empty for forward compatibility. */
export const EXPERIMENTAL_AGENT_IDS: readonly ExperimentalAgentId[] = Object.freeze([]);

/** All recognized agent ids (formal + experimental). Used by the theme system and validation. */
export const ALL_AGENT_IDS: readonly AnyAgentId[] = Object.freeze([
  ...AGENT_IDS,
  ...EXPERIMENTAL_AGENT_IDS,
]);

/**
 * Type guard for formal agent ids only. Used at IPC boundaries so
 * experimental adapters can never be targeted by renderer apply/restore
 * requests — they must go through discovery first.
 */
export function isAgentId(value: unknown): value is AgentId {
  return typeof value === 'string' && (AGENT_IDS as readonly string[]).includes(value);
}

/** Type guard for any recognized agent id (formal + experimental). */
export function isAnyAgentId(value: unknown): value is AnyAgentId {
  return typeof value === 'string' && (ALL_AGENT_IDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Electron app discovery types (launcher feature)
// ---------------------------------------------------------------------------

/** 扫描发现的 Electron 应用 */
export interface ScannedApp {
  /** 唯一标识 = exePath 的 hash */
  id: string;
  exePath: string;
  /** PE 版本信息中提取 */
  productName: string;
  companyName: string;
  /** 应用图标路径（提取自 exe 或 ico） */
  iconPath?: string;
  /** 匹配到的 AgentId (null = 未适配) */
  adapterMatch: AgentId | null;
  /** 安装版本 */
  version?: string;
}

export interface ElectronScanResult {
  /** 已适配应用 = installHints 匹配到的 */
  adapted: ScannedApp[];
  /** 未适配的 Electron 应用 */
  other: ScannedApp[];
}

/** 启动结果 */
export interface LaunchResult {
  ok: boolean;
  pid?: number;
  /** 实际可用的 CDP 端口 (null = 未适配或启动失败) */
  port: number | null;
  state: 'running' | 'launched' | 'needs-restart' | 'failed';
  message: string;
}

export interface Agent {
  id: AgentId;
  name: string;
  category: 'domestic' | 'global' | 'experimental';
  icon: string;
  installed: boolean;
  status: InstallState;
}

export type InstallState =
  | 'IDLE'
  | 'DETECTING'
  | 'APPLYING'
  | 'SUCCESS'
  | 'FAILED'
  | 'REQUIRES_RESTART'
  | 'RESTORE_FAILED';

export interface LocalizedText {
  en: string;
  zh: string;
}

// --- Catalog layer (Phase 4.1: product data abstraction) ---

export interface AgentCapabilities {
  theme: boolean;
  hotReload: boolean;
  extension: boolean;
}

export interface AgentCatalogStatus {
  installed: boolean;
  running: boolean;
  debugReady: boolean;
  version?: string;
}

export interface AgentCatalogItem {
  id: string;
  slug: string;
  name: string;
  displayName: string;
  /** Brand/official name (e.g. "TRAE", "Qoder", "WorkBuddy") — not translated. */
  officialName: string;
  /** Market region for this agent build. */
  region: string;
  /** Engine adapter id (@agentskin/engine) this agent maps to. */
  adapter: string;
  type: 'agent' | 'ide';
  icon: string;
  description: string;
  capabilities: AgentCapabilities;
  supported: boolean;
  status: AgentCatalogStatus;
}

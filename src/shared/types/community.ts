// SPDX-License-Identifier: MPL-2.0

/**
 * # Community Theme Types
 *
 * Shared types for DreamSkin community theme integration. Covers the
 * community theme API contract (list / get / download) and the progress/
 * result payloads pushed between the main process and the renderer.
 */

// --- Community theme metadata ---

export interface CommunityThemeAuthor {
  id: string;
  displayName: string;
  avatarUrl?: string;
}

export interface CommunityThemeSummary {
  /**
   * DreamSkin API 的 `id`（如 "ver_15addf5eaaed738c3a8c"）——用于详情/下载 API 调用。
   * 不要与 slug 混淆。
   */
  themeId: string;
  /** Human-readable slug from DreamSkin API (`themeId` / `slug` field). Used for display/SEO. */
  slug?: string;
  name: string;
  /**
   * Theme author info. May be null for deleted accounts or corrupted API responses.
   * Always use null-checking or optional chaining when accessing author properties.
   * The sanitizeTheme() function in communityStore ensures a default author is
   * present at runtime, but the type contract reflects the raw API shape.
   */
  author: CommunityThemeAuthor | null;
  description: string;
  thumbUrl?: string;
  tags: string[];
  downloads: number;
  /** 收藏数（DreamSkin API favoriteCount），可选。 */
  favoriteCount?: number;
  /** 评分（DreamSkin API 未公开，恒为 0；UI 仅在非零时渲染）。 */
  rating: number;
  updatedAt: string;
  /** Optional size in bytes for download progress preview. */
  packageSize?: number;
  /** SHA-256 checksum of the .agentskin-theme package for verification. */
  packageSha256?: string;
  version: string;
  /** Display metadata (colors) for preview. */
  displayMeta?: {
    colors?: {
      accent?: string;
      background?: string;
      text?: string;
      panel?: string;
      secondary?: string;
      [key: string]: string | undefined;
    };
  };
}

export interface CommunityThemeDetail extends CommunityThemeSummary {
  screenshots: string[];
  changelog?: string;
  /** Target agent IDs that the community theme is known to support. */
  targetAgents: string[];
  /** 许可证信息（社区主题可选字段） */
  license?: string;
}

// --- CodeDrobe categories & creators (社区聚合) ---

export interface CommunityCategory {
  slug: string;
  name: string;
  themeCount: number;
}

export interface CommunityCreator {
  handle: string;
  displayName: string;
  bio?: string;
  avatarUrl?: string;
  socialLinks?: Array<{ platform: string; url: string; username: string }>;
  themeCount?: number;
}

// --- List query ---

export type CommunityThemeSortKey = 'popular' | 'recent' | 'favorites';

export interface CommunityThemeListParams {
  page?: number;
  pageSize?: number;
  sort?: CommunityThemeSortKey;
  agentId?: string;
  tag?: string;
  query?: string;
  /** Source to query — dreamskin or codedrobe. */
  sourceId?: CommunitySourceId;
  /** When true, fetches all themes in one go (used by CodeDrobe where total count is unavailable). */
  fetchAll?: boolean;
  /** Category slug filter (CodeDrobe). */
  categoryId?: string;
}

export interface CommunityThemeListResult {
  themes: CommunityThemeSummary[];
  total: number;
  page: number;
  pageSize: number;
}

// --- Download progress ---

export type DownloadPhase = 'downloading' | 'verifying' | 'installing';

export interface DownloadProgress {
  themeId: string;
  phase: DownloadPhase;
  /** 0–100 overall progress percentage. */
  progress: number;
  bytesDownloaded: number;
  totalBytes: number;
}

// --- Install result ---

export interface InstallResult {
  success: boolean;
  /** The locally-installed theme id (may differ from the community id). */
  themeId?: string;
  error?: string;
}

// --- DreamSkin display metadata (10-color system) ---

export interface DreamSkinDisplayMeta {
  appearance?: 'auto' | 'light' | 'dark';
  colors?: {
    accent?: string;
    secondary?: string;
    background?: string;
    text?: string;
    muted?: string;
    panel?: string;
    panelAlt?: string;
    line?: string;
    [key: string]: string | undefined;
  };
}

/**
 * A community theme as returned by the DreamSkin API. Extends the detail
 * summary with display metadata (10-color palette + appearance mode) used by
 * the color bridge to derive AgentSkin's 14-token palette.
 */
export type CommunityTheme = CommunityThemeDetail & {
  displayMeta?: DreamSkinDisplayMeta;
};

// --- API error ---

/**
 * Error raised by the DreamSkin API client.
 *
 * NOTE: The class implementation lives in `src/main/community/community-theme-api.ts`.
 * This interface ensures the shared type referenced by preload/IPC contracts
 * stays in sync with the runtime class shape. Use the class from the API client
 * for `instanceof` checks.
 */
export interface DreamSkinApiError {
  name: 'DreamSkinApiError';
  message: string;
  statusCode?: number;
  responseBody?: unknown;
}

// --- Multi-source community state (RFC) ---

// 社区来源ID（dreamskin当前已接入，codedrobe未来接入）
export type CommunitySourceId = 'dreamskin' | 'codedrobe';

// source运行时状态（由UI层通过健康探针动态更新，非静态声明）
export type SourceStatus = 'online' | 'degraded' | 'offline';

// 缓存条目泛型
export interface SourceCacheEntry<T = CommunityThemeSummary[]> {
  data: T;
  fetchedAt: number;
  ttl: number;
  sourceVersion?: string;
}

// 单个source的独立状态切片（避免多source状态串扰）
export interface CommunitySourceState {
  status: SourceStatus;
  error: string | null;
  loading: boolean;
  /** Load-more in-flight flag for this source (mirrored as CommunityState.loadingMore). */
  loadingMore: boolean;
  /** Theme-detail in-flight flag for this source (mirrored as CommunityState.detailLoading). */
  detailLoading: boolean;
  themes: CommunityThemeSummary[];
  total: number;
  page: number;
  pageSize: number;
  sortBy: NonNullable<CommunityThemeSortKey>;
  query: string;
  installingIds: Set<string>;
  installedIds: Set<string>;
  downloadProgress: Map<string, import('./community').DownloadProgress>;
  retryCount: Map<string, number>;
  cache?: SourceCacheEntry<CommunityThemeSummary[]>;
}

// 安装来源追溯记录
export interface InstallationRecord {
  themeId: string;
  sourceId: CommunitySourceId;
  installedAt: number;
  sourceThemeVersion: string;
}

// 来源健康探测结果（主进程 net.fetch 探测后通过 IPC 回传，必须可序列化）
export interface CommunitySourceProbeResult {
  sourceId: CommunitySourceId;
  /** 来源是否已激活（codedrobe 等占位来源为 false，UI 不据此改状态）。 */
  activated: boolean;
  /** 探测是否健康（仅当 activated=true 时有意义）。 */
  healthy: boolean;
  statusCode?: number;
  errorMessage?: string;
  responseTimeMs: number;
}

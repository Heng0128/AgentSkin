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
  themeId: string;
  name: string;
  author: CommunityThemeAuthor;
  description: string;
  thumbUrl?: string;
  tags: string[];
  downloads: number;
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
}

// --- List query ---

export type CommunityThemeSortKey = 'popular' | 'recent' | 'rating';

export interface CommunityThemeListParams {
  page?: number;
  pageSize?: number;
  sort?: CommunityThemeSortKey;
  agentId?: string;
  tag?: string;
  query?: string;
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

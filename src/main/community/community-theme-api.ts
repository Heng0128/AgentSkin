// SPDX-License-Identifier: MPL-2.0

/**
 * # DreamSkin API Client
 *
 * Electron main-process proxy for the DreamSkin community API
 * (https://api.dreamskin.cc). The API sends no CORS headers, so all requests
 * must go through Electron's `net` module (which bypasses CORS entirely) rather
 * than the renderer's `fetch`.
 *
 * ## Endpoints
 *
 * - `GET /v1/themes` — paginated theme list (sort by recent, popular, or rating)
 * - `GET /v1/themes/:id` — single theme detail
 * - `GET /v1/themes/:id/download` — theme ZIP package (streamed, with
 *   progress callbacks and a 50 MB size cap)
 *
 * ## Design rules
 *
 * - All network access uses `net.fetch` from Electron's `net` module — never
 *   the global `fetch` (which would hit CORS).
 * - API responses are validated with type assertions against the shared
 *   community types in `src/shared/types/community.ts`.
 * - Downloads stream the response body in chunks so callers can report progress
 *   and enforce a hard 50 MB limit to prevent OOM from malformed or malicious
 *   responses.
 * - Timeouts use `AbortSignal.timeout` — downloads get a longer budget
 *   (120 s) than metadata calls (30 s). An optional external `AbortSignal`
 *   (for cancellation) can be passed to `downloadTheme`.
 */

import { net } from 'electron';
import type {
  CommunityThemeDetail,
  CommunityThemeListParams,
  CommunityThemeListResult,
  CommunityThemeSummary,
} from '../../shared/types/community';
import { mainError } from '../logger';

const API_BASE = 'https://api.dreamskin.cc/v1';
const DEFAULT_TIMEOUT = 30_000;
const DOWNLOAD_TIMEOUT = 120_000;
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

// ---------------------------------------------------------------------------
// API response → frontend model mapping
// ---------------------------------------------------------------------------

/** Raw theme object returned by DreamSkin API. */
interface RawApiTheme {
  id: string;
  themeId: string;
  name?: string;
  slug?: string;
  version?: string;
  license?: string;
  authorDisplayName?: string | null;
  authorUserId?: string | null;
  downloadCount?: number;
  favoriteCount?: number;
  submittedAt?: string;
  reviewedAt?: string;
  applyCompatible?: boolean;
  packageBytes?: number;
  packageSha256?: string;
  description?: string | null;
  displayMeta?: {
    appearance?: 'light' | 'dark' | 'auto';
    colors?: {
      accent?: string;
      background?: string;
      text?: string;
      [key: string]: string | undefined;
    };
    art?: {
      focusX?: number;
      focusY?: number;
      safeArea?: string;
      taskMode?: string;
    };
  } | null;
  [key: string]: unknown;
}

/** Map a raw API theme object to our frontend CommunityThemeSummary. */
function mapApiToThemeSummary(raw: RawApiTheme): CommunityThemeSummary {
  return {
    themeId: raw.themeId || raw.slug || raw.id,
    name: raw.name || raw.slug || 'Untitled Theme',
    author: {
      id: raw.authorUserId || 'unknown',
      displayName: raw.authorDisplayName || 'Unknown',
    },
    description: raw.description || '',
    tags: [], // DreamSkin API does not expose tags in list endpoint
    downloads: raw.downloadCount ?? 0,
    rating: 0, // DreamSkin API does not expose rating
    updatedAt: raw.reviewedAt || raw.submittedAt || new Date().toISOString(),
    version: raw.version || '1.0.0',
    packageSize: raw.packageBytes,
    packageSha256: raw.packageSha256,
  };
}

/**
 * Error raised by DreamSkin API client functions.
 *
 * Carries the HTTP status code (when available) and the parsed response body
 * (when available) so callers can differentiate network failures, 404s, and
 * 5xx errors without re-parsing.
 */
export class DreamSkinApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly responseBody?: unknown,
  ) {
    super(message);
    this.name = 'DreamSkinApiError';
  }
}

/**
 * Fetch a paginated list of community themes.
 *
 * The DreamSkin API uses `limit`/`offset` pagination, but the shared
 * `CommunityThemeListParams` uses `page`/`pageSize` — this function translates
 * between the two.
 *
 * @param params - Pagination, filter, and sort options.
 * @returns Validated theme list + total count + page metadata.
 */
export async function fetchThemes(
  params: CommunityThemeListParams = {},
): Promise<CommunityThemeListResult> {
  const {
    page = 1,
    pageSize = 20,
    sort = 'recent',
    agentId,
    tag,
    query,
  } = params;

  const limit = pageSize;
  const offset = (page - 1) * pageSize;

  const url = new URL(`${API_BASE}/themes`);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('sort', sort);
  if (agentId) url.searchParams.set('agent', agentId);
  if (tag) url.searchParams.set('tag', tag);
  if (query) url.searchParams.set('q', query);

  const response = await net.fetch(url.toString(), {
    method: 'GET',
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
  });

  if (!response.ok) {
    throw new DreamSkinApiError(
      `Failed to fetch themes: HTTP ${response.status}`,
      response.status,
    );
  }

  const body = (await response.json()) as {
    items: RawApiTheme[];
    total: number;
    limit: number;
    offset: number;
  };

  return {
    themes: body.items.map(mapApiToThemeSummary),
    total: body.total,
    page,
    pageSize,
  };
}

/**
 * Fetch a single theme's detail by id.
 *
 * @param id - Theme id (validated by the shared type).
 * @returns Validated `CommunityThemeDetail` object.
 */
export async function getThemeDetail(id: string): Promise<CommunityThemeDetail> {
  if (!id || typeof id !== 'string') {
    throw new DreamSkinApiError('Invalid theme ID: expected a non-empty string');
  }

  const url = `${API_BASE}/themes/${encodeURIComponent(id)}`;

  const response = await net.fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
  });

  if (!response.ok) {
    throw new DreamSkinApiError(
      `Failed to get theme detail: HTTP ${response.status}`,
      response.status,
    );
  }

  const raw = (await response.json()) as RawApiTheme;
  const summary = mapApiToThemeSummary(raw);
  // Detail extends Summary — preserve screenshots/targetAgents if API provides them
  const detail: CommunityThemeDetail = {
    ...summary,
    screenshots: (raw as { screenshots?: string[] }).screenshots ?? [],
    targetAgents: (raw as { targetAgents?: string[] }).targetAgents ?? [],
    changelog: (raw as { changelog?: string }).changelog,
  };
  return detail;
}

/**
 * Download a theme ZIP package as a Buffer, with progress callbacks.
 *
 * Streams the response body in chunks so callers can report progress and
 * enforce a hard size cap (50 MB) without buffering the entire file up-front.
 *
 * @param id - Theme id to download.
 * @param onProgress - Optional callback invoked with `(bytesDownloaded, totalBytes)`
 *   after each chunk. `totalBytes` comes from the `Content-Length` header and
 *   may be `0` if the server omits it.
 * @param externalSignal - Optional `AbortSignal` for cancellation (e.g. from
 *   an `AbortController`). Fires alongside the internal 120 s timeout.
 * @returns The complete ZIP package as a Node `Buffer`.
 */
export async function downloadTheme(
  id: string,
  onProgress?: (bytesDownloaded: number, totalBytes: number) => void,
  externalSignal?: AbortSignal,
): Promise<Buffer> {
  if (!id || typeof id !== 'string') {
    throw new DreamSkinApiError('Invalid theme ID: expected a non-empty string');
  }

  const url = `${API_BASE}/themes/${encodeURIComponent(id)}/download`;

  // Combine the internal timeout with the external cancellation signal so
  // either one can abort the fetch.
  const timeoutSignal = AbortSignal.timeout(DOWNLOAD_TIMEOUT);
  const signal =
    externalSignal
      ? AbortSignal.any([timeoutSignal, externalSignal])
      : timeoutSignal;

  const response = await net.fetch(url, {
    method: 'GET',
    signal,
  });

  if (!response.ok) {
    throw new DreamSkinApiError(
      `Failed to download theme: HTTP ${response.status}`,
      response.status,
    );
  }

  const contentLength = Number.parseInt(
    response.headers.get('Content-Length') || '0',
    10,
  );

  if (contentLength > MAX_DOWNLOAD_BYTES) {
    throw new DreamSkinApiError(
      `Package exceeds 50MB limit (Content-Length: ${contentLength})`,
    );
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new DreamSkinApiError('Failed to get response body reader');
  }

  const chunks: Buffer[] = [];
  let bytesDownloaded = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(Buffer.from(value));
      bytesDownloaded += value.length;

      if (bytesDownloaded > MAX_DOWNLOAD_BYTES) {
        throw new DreamSkinApiError(
          `Package exceeds 50MB limit during download (received ${bytesDownloaded} bytes)`,
        );
      }

      if (onProgress && contentLength > 0) {
        onProgress(bytesDownloaded, contentLength);
      }
    }
  } catch (error) {
    // Distinguish our own size-limit throw from a genuine network failure.
    if (error instanceof DreamSkinApiError) throw error;
    mainError('community-api', `Download interrupted for theme ${id}: ${String(error)}`);
    throw new DreamSkinApiError(`Download interrupted: ${String(error)}`);
  } finally {
    // Always release the reader so the underlying socket can be reused.
    reader.cancel().catch(() => {});
  }

  return Buffer.concat(chunks);
}

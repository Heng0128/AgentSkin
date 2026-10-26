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
 * - `GET /v1/themes` — paginated theme list (sort by recent, popular, or favorites)
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

export const API_BASE = 'https://api.dreamskin.cc/v1';
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
  // DreamSkin serves preview images from a dedicated endpoint:
  //   GET /v1/themes/{id}/preview → { background: { url: ".../preview/background" } }
  // We construct the URL directly to avoid extra API calls per theme in the list.
  // Size params let the CDN return a properly-sized thumbnail, saving bandwidth.
  const thumbUrl = `${API_BASE}/themes/${raw.id}/preview/background?width=320&height=180&fit=cover`;

  return {
    // CRITICAL: themeId MUST be the DreamSkin API `id` (e.g. "ver_15addf5eaaed738c3a8c")
    // because it is used for /themes/{id}/detail and /themes/{id}/download API calls.
    // The slug (raw.themeId) is only for display/SEO.
    // Fallback: if `id` is missing (unexpected), use themeId/slug to avoid undefined.
    themeId: raw.id || raw.themeId || raw.slug || '',
    slug: raw.themeId || raw.slug || raw.id || '',
    name: raw.name || raw.slug || 'Untitled Theme',
    author: {
      id: raw.authorUserId || 'unknown',
      displayName: raw.authorDisplayName || 'Unknown',
    },
    description: raw.description || '',
    tags: [], // DreamSkin API does not expose tags in list endpoint
    downloads: raw.downloadCount ?? 0,
    favoriteCount: raw.favoriteCount ?? 0,
    rating: 0, // DreamSkin API does not expose rating
    updatedAt: raw.reviewedAt || raw.submittedAt || new Date().toISOString(),
    version: raw.version || '1.0.0',
    packageSize: raw.packageBytes,
    packageSha256: raw.packageSha256,
    thumbUrl,
    // Preserve theme colors for preview bar display
    displayMeta: raw.displayMeta?.colors
      ? {
          colors: raw.displayMeta.colors,
        }
      : undefined,
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
  const { page = 1, pageSize = 20, sort = 'recent', agentId, tag, query } = params;

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
    headers: {
      'User-Agent': 'AgentSkin/1.0',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
  });

  if (!response.ok) {
    throw new DreamSkinApiError(`Failed to fetch themes: HTTP ${response.status}`, response.status);
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
    headers: {
      'User-Agent': 'AgentSkin/1.0',
      Accept: 'application/json',
    },
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

  // 2026-09-03: 远端 CDN 边缘（Cloudflare 非本地 PoP）偶发 keep-alive 中断 →
  // Chromium fetch 抛 AbortError。对网络性中断做有限重试（用户取消 / 超限不重试）。
  const MAX_ATTEMPTS = 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const timeoutSignal = AbortSignal.timeout(DOWNLOAD_TIMEOUT);
    const signal = externalSignal
      ? AbortSignal.any([timeoutSignal, externalSignal])
      : timeoutSignal;

    try {
      return await doFetchDownload(id, url, signal, onProgress);
    } catch (error) {
      // 用户取消 / 明确 HTTP / 体积超限 → 直接抛，不重试。
      if (externalSignal?.aborted) throw new DreamSkinApiError('Download cancelled');
      if (error instanceof DreamSkinApiError) throw error;
      lastError = error;
      const isHttpError = error instanceof Error && /HTTP \d{3}/.test(error.message);
      if (isHttpError) throw error;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 800 * attempt));
      }
    }
  }
  mainError('community-api', `Download interrupted for theme ${id}: ${String(lastError)}`);
  throw new DreamSkinApiError(`Download interrupted: ${String(lastError)}`);
}

/** Single download attempt (streamed, size-capped, progress-reporting). */
async function doFetchDownload(
  _id: string,
  url: string,
  signal: AbortSignal,
  onProgress?: (bytesDownloaded: number, totalBytes: number) => void,
): Promise<Buffer> {
  const response = await net.fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': 'AgentSkin/1.0',
      Accept: 'application/json',
    },
    signal,
  });

  if (!response.ok) {
    throw new DreamSkinApiError(
      `Failed to download theme: HTTP ${response.status}`,
      response.status,
    );
  }

  const contentLength = Number.parseInt(response.headers.get('Content-Length') || '0', 10);

  if (contentLength > MAX_DOWNLOAD_BYTES) {
    throw new DreamSkinApiError(`Package exceeds 50MB limit (Content-Length: ${contentLength})`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new DreamSkinApiError('Failed to get response body reader');
  }

  const chunks: Buffer[] = [];
  let bytesDownloaded = 0;

  // 每块读取的看门狗：Chromium net.Response 的 reader.read() 在远端 keep-alive
  // 半开（无数据也不断连）时可能不响应 abort 信号 → 全局 120s 超时形同虚设，
  // 表现为 UI "一直卡着"。首字节宽容 60s（服务端可能现压 ZIP），后续块 20s，
  // 停滞即失败 → 外层重试。
  let isFirstRead = true;
  const readWithWatchdog = (): Promise<Awaited<ReturnType<typeof reader.read>>> =>
    new Promise((resolve, reject) => {
      const stallMs = isFirstRead ? 60_000 : 20_000;
      const timer = setTimeout(() => {
        reject(new Error(`download stalled: no data for ${stallMs / 1000}s`));
      }, stallMs);
      reader
        .read()
        .then((r) => {
          clearTimeout(timer);
          isFirstRead = false;
          resolve(r);
        })
        .catch((e) => {
          clearTimeout(timer);
          reject(e);
        });
    });

  try {
    while (true) {
      const { done, value } = await readWithWatchdog();
      if (done) break;

      chunks.push(Buffer.from(value));
      bytesDownloaded += value.length;

      if (bytesDownloaded > MAX_DOWNLOAD_BYTES) {
        throw new DreamSkinApiError(
          `Package exceeds 50MB limit during download (received ${bytesDownloaded} bytes)`,
        );
      }

      // 无条件上报进度：Content-Length 缺失（分块传输）时仍要让 UI 看到字节在动，
      // 否则进度与字节行都会冻在 0。
      if (onProgress) onProgress(bytesDownloaded, contentLength);
    }
  } finally {
    // Always release the reader so the underlying socket can be reused.
    reader.cancel().catch(() => {});
  }

  return Buffer.concat(chunks);
}

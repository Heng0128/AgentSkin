// SPDX-License-Identifier: MPL-2.0

/**
 * # CodeDrobe API Client
 *
 * CodeDrobe 开放 API（https://codedrobe.app/api/v1）客户端。
 * 使用 Node.js 原生 https模块，避免 Electron net.fetch 对 codedrobe.app CDN 返回 400。
 */

import * as https from 'node:https';
import { URL } from 'node:url';
import type {
  CommunityThemeAuthor,
  CommunityThemeDetail,
  CommunityThemeListParams,
  CommunityThemeListResult,
  CommunityThemeSummary,
} from '../../shared/types/community';
import { mainError } from '../logger';

/** CodeDrobe API base — 对应 https://codedrobe.app/zh/themes 页面后端 */
export const CODE_DROBE_API_BASE = 'https://codedrobe.app/api/v1';

const DEFAULT_TIMEOUT = 30_000;
const DOWNLOAD_TIMEOUT = 120_000;
const MAX_DOWNLOAD_BYTES = 30 * 1024 * 1024; // 30 MB

// ---------------------------------------------------------------------------
// API 原始类型
// ---------------------------------------------------------------------------

interface RawCodeDrobeTheme {
  id: string;
  slug: string;
  name: { en?: string; zh?: string; [key: string]: string | undefined };
  description: { en?: string; zh?: string; [key: string]: string | undefined } | null;
  version: string;
  categories?: Array<{
    slug: string;
    name: { en?: string; zh?: string; [key: string]: string | undefined };
    primary?: boolean;
  }>;
  previewUrl?: string | null;
  coverUrl: string;
  downloadUrl: string;
  price?: { currency: string; unitAmount: number; free: boolean };
  package: { sizeBytes: number; sha256: string };
  publishedAt: string;
  supportedApps: string[];
  author: {
    handle: string;
    displayName: string;
    avatarUrl?: string;
    socialLinks?: Array<{
      platform: string;
      url: string;
      username: string | null;
      isVerified?: boolean;
    }>;
  };
  likeCount?: number;
  downloadCount?: number;
}

interface RawListResponse {
  data: RawCodeDrobeTheme[];
  total?: number;
}

// ---------------------------------------------------------------------------
// 映射函数
// ---------------------------------------------------------------------------

function pickLocalized(
  obj: Record<string, string | undefined> | null | undefined,
): string | undefined {
  if (!obj) return undefined;
  return obj.zh ?? obj.en ?? Object.values(obj).find(Boolean);
}

const CODEDROBE_APP_MAP: Record<string, string> = {
  codex: 'codex',
  qoderwork: 'qoderwork',
  traework: 'traework',
  workbuddy: 'workbuddy',
  doubao: 'doubao',
  zcode: 'zcode',
};

function mapCodeDrobeToSummary(raw: RawCodeDrobeTheme): CommunityThemeSummary {
  const name = pickLocalized(raw.name) ?? raw.slug;
  const description = pickLocalized(raw.description) ?? '';
  const tags = (raw.categories ?? []).map((c) => c.slug).filter(Boolean);

  const author: CommunityThemeAuthor = {
    id: raw.author?.handle ?? 'unknown',
    displayName: raw.author?.displayName ?? raw.author?.handle ?? 'Unknown',
    avatarUrl: raw.author?.avatarUrl,
  };

  const thumbUrl = raw.coverUrl?.startsWith('http')
    ? raw.coverUrl
    : `https://codedrobe.app${raw.coverUrl}`;

  const primaryCategory = raw.categories?.find((c) => c.primary);

  return {
    themeId: raw.slug,
    slug: raw.slug,
    name,
    author,
    description,
    tags,
    downloads: raw.downloadCount ?? 0,
    favoriteCount: raw.likeCount ?? 0,
    rating: 0,
    updatedAt: raw.publishedAt,
    version: raw.version || '1.0.0',
    packageSize: raw.package.sizeBytes,
    packageSha256: raw.package.sha256,
    thumbUrl,
    displayMeta: primaryCategory ? { colors: undefined } : undefined,
  };
}

function mapCodeDrobeToDetail(raw: RawCodeDrobeTheme): CommunityThemeDetail {
  const summary = mapCodeDrobeToSummary(raw);
  return {
    ...summary,
    screenshots: [],
    targetAgents: raw.supportedApps
      .map((app) => CODEDROBE_APP_MAP[app])
      .filter(Boolean) as string[],
    changelog: undefined,
    license: undefined,
  };
}

// ---------------------------------------------------------------------------
// 错误类型
// ---------------------------------------------------------------------------

export class CodeDrobeApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'CodeDrobeApiError';
  }
}

// ---------------------------------------------------------------------------
// Node.js HTTPS 请求
// ---------------------------------------------------------------------------

/**
 * JSON GET 请求。直接使用 https.get 传入完整 URL 字符串
 * （经测试：Node.js 原生 https 模块对 codedrobe.app 返回 200）。
 */
function httpsGetJson<T>(urlStr: string, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const req = https.get(
      urlStr,
      {
        headers: {
          'User-Agent': 'AgentSkin/1.0',
          Accept: 'application/json',
        },
      },
      (res) => {
        const statusCode = res.statusCode ?? 0;

        // 处理 30x 重定向
        if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
          res.resume();
          httpsGetJson<T>(res.headers.location, timeoutMs).then(resolve, reject);
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          res.resume();
          reject(new CodeDrobeApiError(`HTTP ${statusCode}`, statusCode));
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('utf-8');
            resolve(JSON.parse(body) as T);
          } catch (e) {
            reject(new CodeDrobeApiError(`JSON parse error: ${(e as Error).message}`));
          }
        });
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new CodeDrobeApiError(`Timeout after ${timeoutMs}ms`));
    });

    req.on('error', (err) => {
      reject(new CodeDrobeApiError(`Network error: ${err.message}`));
    });
  });
}

/**
 * Buffer GET 请求（用于下载文件），支持进度回调和取消信号。
 */
function httpsGetBuffer(
  urlStr: string,
  timeoutMs: number,
  onProgress?: (bytesDownloaded: number, totalBytes: number) => void,
  abortSignal?: AbortSignal,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    if (abortSignal?.aborted) {
      reject(new CodeDrobeApiError('Download cancelled'));
      return;
    }

    const req = https.get(
      urlStr,
      {
        headers: {
          'User-Agent': 'AgentSkin/1.0',
          Accept: 'application/json',
        },
      },
      (res) => {
        const statusCode = res.statusCode ?? 0;

        if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
          res.resume();
          httpsGetBuffer(res.headers.location, timeoutMs, onProgress, abortSignal).then(
            resolve,
            reject,
          );
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          res.resume();
          reject(new CodeDrobeApiError(`HTTP ${statusCode}`, statusCode));
          return;
        }

        const contentLength = Number.parseInt(res.headers['content-length'] ?? '0', 10);

        if (contentLength > MAX_DOWNLOAD_BYTES) {
          req.destroy();
          reject(new CodeDrobeApiError(`Content too large: ${contentLength}`));
          return;
        }

        const chunks: Buffer[] = [];
        let bytesDownloaded = 0;

        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
          bytesDownloaded += chunk.length;
          if (onProgress) onProgress(bytesDownloaded, contentLength);
        });

        res.on('end', () => {
          resolve(Buffer.concat(chunks));
        });
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new CodeDrobeApiError(`Timeout after ${timeoutMs}ms`));
    });

    req.on('error', (err) => {
      reject(new CodeDrobeApiError(`Network error: ${err.message}`));
    });

    abortSignal?.addEventListener('abort', () => {
      req.destroy(new CodeDrobeApiError('Download cancelled'));
    });

    req.end();
  });
}

// ---------------------------------------------------------------------------
// API 调用
// ---------------------------------------------------------------------------

/**
 * 获取 CodeDrobe 主题列表。
 * CodeDrobe API 忽略分页参数（始终返回全部公开主题）。
 */
export async function fetchCodeDrobeList(
  params: CommunityThemeListParams = {},
): Promise<CommunityThemeListResult> {
  const { sort = 'recent', query } = params;
  const sortValue = sort === 'recent' ? 'newest' : sort === 'popular' ? 'popular' : 'newest';

  const url = new URL(`${CODE_DROBE_API_BASE}/themes`);
  url.searchParams.set('page', '1');
  url.searchParams.set('pageSize', '50');
  url.searchParams.set('sort', sortValue);
  if (query) url.searchParams.set('q', query);

  const body = await httpsGetJson<RawListResponse>(url.toString(), DEFAULT_TIMEOUT);
  const themes = (body.data ?? []).map(mapCodeDrobeToSummary);

  return {
    themes,
    total: themes.length,
    page: 1,
    pageSize: themes.length,
  };
}

export async function fetchCodeDrobeDetail(slug: string): Promise<CommunityThemeDetail> {
  if (!slug || typeof slug !== 'string') {
    throw new CodeDrobeApiError('Invalid theme slug: expected a non-empty string');
  }

  const url = `${CODE_DROBE_API_BASE}/themes/${encodeURIComponent(slug)}`;
  const body = await httpsGetJson<{ data: RawCodeDrobeTheme }>(url, DEFAULT_TIMEOUT);
  return mapCodeDrobeToDetail(body.data);
}

export async function downloadCodeDrobeTheme(
  slug: string,
  onProgress?: (bytesDownloaded: number, totalBytes: number) => void,
  externalSignal?: AbortSignal,
): Promise<Buffer> {
  if (!slug || typeof slug !== 'string') {
    throw new CodeDrobeApiError('Invalid theme slug: expected a non-empty string');
  }

  const url = `${CODE_DROBE_API_BASE}/themes/${encodeURIComponent(slug)}/download`;

  const MAX_ATTEMPTS = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await httpsGetBuffer(url, DOWNLOAD_TIMEOUT, onProgress, externalSignal);
    } catch (error) {
      if (externalSignal?.aborted) throw new CodeDrobeApiError('Download cancelled');
      if (error instanceof CodeDrobeApiError) throw error;
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 800 * attempt));
      }
    }
  }

  mainError('codedrobe-api', `Download interrupted for theme ${slug}: ${String(lastError)}`);
  throw new CodeDrobeApiError(`Download interrupted: ${String(lastError)}`);
}

export const IS_API_AVAILABLE = true;

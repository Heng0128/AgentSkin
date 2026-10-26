// SPDX-License-Identifier: MPL-2.0

/**
 * # Community Direct API（渲染进程直连）
 *
 * CodeDrobe API 已开启 CORS（`Access-Control-Allow-Origin: *`），
 * 因此可在渲染进程直接用浏览器 `fetch` 调用，绕过主进程 IPC。
 *
 * 这样做的原因：
 * - Electron 主进程的 `net.fetch` 和 Node.js `https` 对 codedrobe.app CDN
 *   均返回 HTTP 400（CDN 的 TLS 指纹拦截）
 * - 但浏览器原生 `fetch` 能正常访问（CORS 已开放）
 *
 * DreamSkin API 没有 CORS，仍走主进程 IPC（`api.*`）。
 */

import type {
  CommunityThemeDetail,
  CommunityThemeListParams,
  CommunityThemeListResult,
} from '@shared/types/community';

const CODE_DROBE_API_BASE = 'https://codedrobe.app/api/v1';

interface RawTheme {
  id: string;
  slug: string;
  name: { en?: string; zh?: string };
  description: { en?: string; zh?: string } | null;
  version: string;
  categories?: Array<{ slug: string; name: { en?: string; zh?: string }; primary?: boolean }>;
  previewUrl?: string | null;
  coverUrl?: string;
  downloadUrl?: string;
  price?: { currency: string; unitAmount: number; free: boolean };
  package: { sizeBytes: number; sha256: string };
  publishedAt: string;
  supportedApps: string[];
  author: {
    handle: string;
    displayName: string;
    avatarUrl?: string;
    socialLinks?: Array<{ platform: string; url: string; username: string }>;
  };
  likeCount?: number;
  downloadCount?: number;
}

interface RawListMeta {
  total: number;
  nextCursor: string | null;
  sort: string;
  limit: number;
  app?: string | null;
  category?: string | null;
  creator?: string | null;
  query?: string | null;
}

interface RawListResponse {
  data: RawTheme[];
  meta: RawListMeta;
}

function pick(obj?: { en?: string; zh?: string } | null): string | undefined {
  if (!obj) return undefined;
  return obj.zh ?? obj.en;
}

function mapTheme(raw: RawTheme) {
  const name = pick(raw.name) ?? raw.slug;
  const description = pick(raw.description) ?? '';
  const tags = (raw.categories ?? []).map((c) => c.slug).filter(Boolean);

  // Thumbnail: prefer absolute previewUrl, then coverUrl (may be relative → prepend origin).
  let thumbUrl: string | undefined;
  const rawThumb = raw.previewUrl && raw.previewUrl !== 'null' ? raw.previewUrl : raw.coverUrl;
  if (rawThumb) {
    thumbUrl = rawThumb.startsWith('http') ? rawThumb : `https://codedrobe.app${rawThumb}`;
  }

  return {
    themeId: raw.slug,
    slug: raw.slug,
    name,
    author: {
      id: raw.author?.handle ?? 'unknown',
      displayName: raw.author?.displayName ?? raw.author?.handle ?? 'Unknown',
      avatarUrl: raw.author?.avatarUrl,
    },
    description,
    tags,
    downloads: raw.downloadCount ?? 0,
    favoriteCount: raw.likeCount ?? 0,
    rating: 0,
    updatedAt: raw.publishedAt,
    version: raw.version || '1.0.0',
    packageSize: raw.package?.sizeBytes,
    packageSha256: raw.package?.sha256,
    thumbUrl,
  };
}

/**
 * CodeDrobe 主题列表 — 浏览器 fetch 直连。
 *
 * 分页策略：cursor-based。首次 `?limit=24`，后续 `?limit=24&cursor=<nextCursor>`。
 * `meta.total` 返回实际总数（如 45），`meta.nextCursor` 为空时结束。
 *
 * Sort 映射：popular → downloads，recent/favorites → newest。
 */
export async function fetchCodeDrobeThemesList(
  params: CommunityThemeListParams = {},
): Promise<CommunityThemeListResult> {
  const PAGE_LIMIT = 24;

  // Map generic sort key → CodeDrobe values (downloads | newest).
  const sort = params.sort === 'popular' ? 'downloads' : 'newest';

  const allThemes: ReturnType<typeof mapTheme>[] = [];
  const seenSlugs = new Set<string>();
  let cursor: string | null = null;
  let total = 0;
  let pageCount = 0;

  do {
    const url = new URL(`${CODE_DROBE_API_BASE}/themes`);
    url.searchParams.set('limit', String(PAGE_LIMIT));
    url.searchParams.set('sort', sort);
    if (cursor) url.searchParams.set('cursor', cursor);
    if (params.agentId) url.searchParams.set('app', params.agentId);
    if (params.categoryId) url.searchParams.set('category', params.categoryId);
    if (params.query) url.searchParams.set('q', params.query);

    // Note: do NOT set User-Agent — Chromium default UA is required
    // to pass Cloudflare bot detection. Overriding it causes HTTP 400.
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch CodeDrobe themes (page ${pageCount + 1}): HTTP ${response.status}`,
      );
    }

    const body = (await response.json()) as RawListResponse;
    total = body.meta?.total ?? 0;
    cursor = body.meta?.nextCursor ?? null;
    pageCount++;

    for (const raw of body.data ?? []) {
      const mapped = mapTheme(raw);
      if (!seenSlugs.has(mapped.slug)) {
        seenSlugs.add(mapped.slug);
        allThemes.push(mapped);
      }
    }
  } while (cursor);

  return {
    themes: allThemes,
    total,
    page: 1,
    pageSize: allThemes.length,
  };
}

/**
 * CodeDrobe 主题详情 — 浏览器 fetch 直连。
 */
export async function fetchCodeDrobeThemeDetail(slug: string): Promise<CommunityThemeDetail> {
  const url = `${CODE_DROBE_API_BASE}/themes/${encodeURIComponent(slug)}`;
  // Note: do NOT set User-Agent — the default Chromium UA is required
  // to pass Cloudflare bot detection. Overriding it causes HTTP 400.
  const response = await fetch(url, { headers: { Accept: 'application/json' } });

  if (!response.ok) {
    throw new Error(`Failed to get CodeDrobe theme detail: HTTP ${response.status}`);
  }

  const body = (await response.json()) as { data: RawTheme };
  const mapped = mapTheme(body.data);

  return {
    ...mapped,
    screenshots: [],
    targetAgents: body.data.supportedApps,
    changelog: undefined,
    license: undefined,
  };
}

/* -------------------------------------------------------------------------- */
/* Categories                                                                 */
/* -------------------------------------------------------------------------- */

interface RawCategory {
  id?: string;
  slug: string;
  name: { en?: string; zh?: string } | string;
  description?: { en?: string; zh?: string } | string;
  themeCount?: number;
}

/**
 * 获取 CodeDrobe 主题分类列表。
 */
export async function fetchCodeDrobeCategories(): Promise<
  import('@shared/types/community').CommunityCategory[]
> {
  const url = `${CODE_DROBE_API_BASE}/categories`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch CodeDrobe categories: HTTP ${response.status}`);
  }

  const body = (await response.json()) as { data: RawCategory[] };

  return (body.data ?? []).map((c) => ({
    slug: c.slug,
    name: typeof c.name === 'string' ? c.name : (c.name.zh ?? c.name.en ?? c.slug),
    themeCount: c.themeCount ?? 0,
  }));
}

/* -------------------------------------------------------------------------- */
/* Creators                                                                   */
/* -------------------------------------------------------------------------- */

interface RawCreator {
  handle: string;
  displayName: string;
  bio?: string;
  avatarUrl?: string;
  socialLinks?: Array<{ platform: string; url: string; username: string }>;
  themeCount?: number;
}

/**
 * 获取 CodeDrobe 创作者列表。
 */
export async function fetchCodeDrobeCreators(): Promise<
  import('@shared/types/community').CommunityCreator[]
> {
  const url = `${CODE_DROBE_API_BASE}/creators`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch CodeDrobe creators: HTTP ${response.status}`);
  }

  const body = (await response.json()) as { data: RawCreator[] };

  return (body.data ?? []).map((c) => ({
    handle: c.handle,
    displayName: c.displayName,
    bio: c.bio,
    avatarUrl: c.avatarUrl,
    socialLinks: c.socialLinks,
    themeCount: c.themeCount,
  }));
}

/**
 * 获取 CodeDrobe 单个创作者详情。
 */
export async function fetchCodeDrobeCreatorDetail(
  handle: string,
): Promise<import('@shared/types/community').CommunityCreator> {
  const url = `${CODE_DROBE_API_BASE}/creators/${encodeURIComponent(handle)}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch CodeDrobe creator ${handle}: HTTP ${response.status}`);
  }

  const body = (await response.json()) as { data: RawCreator };
  const c = body.data;

  return {
    handle: c.handle,
    displayName: c.displayName,
    bio: c.bio,
    avatarUrl: c.avatarUrl,
    socialLinks: c.socialLinks,
    themeCount: c.themeCount,
  };
}

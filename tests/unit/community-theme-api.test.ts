// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock electron's net module before importing the module under test
// Use vi.hoisted() to ensure mock variables are available in vi.mock factories
// (vi.mock is hoisted to the top of the file by the bundler).
// ---------------------------------------------------------------------------

const { mockFetch, mockMainError } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockMainError: vi.fn(),
}));

vi.mock('electron', () => ({
  net: { fetch: mockFetch },
}));

vi.mock('../../src/main/logger', () => ({
  mainError: mockMainError,
}));

// Import after mocks are set up
import {
  fetchThemes,
  getThemeDetail,
  downloadTheme,
  DreamSkinApiError,
} from '../../src/main/community/community-theme-api';
import type {
  CommunityThemeSummary,
  CommunityThemeDetail,
} from '../../shared/types/community';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const sampleThemeSummary: CommunityThemeSummary = {
  themeId: 'theme-001',
  name: 'Test Theme',
  author: { id: 'author-1', displayName: 'TestAuthor' },
  description: 'A test theme',
  tags: ['dark'],
  downloads: 100,
  rating: 4.5,
  updatedAt: '2025-01-15T10:30:00Z',
  version: '1.0.0',
};

const sampleThemeDetail: CommunityThemeDetail = {
  ...sampleThemeSummary,
  themeId: 'theme-001',
  screenshots: ['https://example.com/screenshot.png'],
  targetAgents: ['traework'],
};

// Helper to create a mock Response
function createMockResponse(options: {
  ok: boolean;
  status?: number;
  json?: unknown;
  body?: ReadableStream | null;
  headers?: Record<string, string>;
}): Response {
  const { ok, status = 200, json, body = null, headers = {} } = options;

  return {
    ok,
    status,
    headers: {
      get: (name: string) => headers[name] ?? null,
    },
    json: json ? async () => json : async () => ({}),
    body,
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// describe: DreamSkinApiError
// ---------------------------------------------------------------------------

describe('DreamSkinApiError', () => {
  it('creates an error with message only', () => {
    const err = new DreamSkinApiError('Something went wrong');
    expect(err.message).toBe('Something went wrong');
    expect(err.name).toBe('DreamSkinApiError');
    expect(err.statusCode).toBeUndefined();
    expect(err.responseBody).toBeUndefined();
  });

  it('creates an error with status code', () => {
    const err = new DreamSkinApiError('Not found', 404);
    expect(err.statusCode).toBe(404);
  });

  it('creates an error with status code and response body', () => {
    const body = { error: 'Theme not found' };
    const err = new DreamSkinApiError('Not found', 404, body);
    expect(err.statusCode).toBe(404);
    expect(err.responseBody).toEqual(body);
  });

  it('is an instance of Error', () => {
    const err = new DreamSkinApiError('test');
    expect(err).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// describe: fetchThemes
// ---------------------------------------------------------------------------

describe('fetchThemes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches themes with default parameters', async () => {
    const mockResponse = createMockResponse({
      ok: true,
      json: {
        items: [sampleThemeSummary],
        total: 1,
        limit: 20,
        offset: 0,
      },
    });
    mockFetch.mockResolvedValueOnce(mockResponse);

    const result = await fetchThemes();

    expect(result.themes).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('translates page/pageSize to limit/offset', async () => {
    const mockResponse = createMockResponse({
      ok: true,
      json: { items: [], total: 0, limit: 10, offset: 20 },
    });
    mockFetch.mockResolvedValueOnce(mockResponse);

    await fetchThemes({ page: 3, pageSize: 10 });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('limit=10');
    expect(calledUrl).toContain('offset=20');
  });

  it('includes sort, agentId, tag, and query params when provided', async () => {
    const mockResponse = createMockResponse({
      ok: true,
      json: { items: [], total: 0, limit: 20, offset: 0 },
    });
    mockFetch.mockResolvedValueOnce(mockResponse);

    await fetchThemes({
      sort: 'popular',
      agentId: 'traework',
      tag: 'dark',
      query: 'neon',
    });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('sort=popular');
    expect(calledUrl).toContain('agent=traework');
    expect(calledUrl).toContain('tag=dark');
    expect(calledUrl).toContain('q=neon');
  });

  it('throws DreamSkinApiError on HTTP error', async () => {
    const mockResponse = createMockResponse({
      ok: false,
      status: 500,
    });
    mockFetch.mockResolvedValue(mockResponse);

    await expect(fetchThemes()).rejects.toThrow(DreamSkinApiError);
    await expect(fetchThemes()).rejects.toThrow('HTTP 500');
  });

  it('throws DreamSkinApiError on 404', async () => {
    const mockResponse = createMockResponse({
      ok: false,
      status: 404,
    });
    mockFetch.mockResolvedValueOnce(mockResponse);

    await expect(fetchThemes()).rejects.toThrow('HTTP 404');
  });
});

// ---------------------------------------------------------------------------
// describe: getThemeDetail
// ---------------------------------------------------------------------------

describe('getThemeDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches theme detail by id', async () => {
    const mockResponse = createMockResponse({
      ok: true,
      json: sampleThemeDetail,
    });
    mockFetch.mockResolvedValueOnce(mockResponse);

    const result = await getThemeDetail('theme-001');

    expect(result.themeId).toBe('theme-001');
    expect(result.name).toBe('Test Theme');
    expect(result.screenshots).toHaveLength(1);
  });

  it('encodes the theme id in the URL', async () => {
    const mockResponse = createMockResponse({
      ok: true,
      json: sampleThemeDetail,
    });
    mockFetch.mockResolvedValueOnce(mockResponse);

    await getThemeDetail('theme/with special&chars');

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain(encodeURIComponent('theme/with special&chars'));
  });

  it('throws DreamSkinApiError for empty id', async () => {
    await expect(getThemeDetail('')).rejects.toThrow(DreamSkinApiError);
    await expect(getThemeDetail('')).rejects.toThrow('Invalid theme ID');
  });

  it('throws DreamSkinApiError on HTTP error', async () => {
    const mockResponse = createMockResponse({
      ok: false,
      status: 404,
    });
    mockFetch.mockResolvedValueOnce(mockResponse);

    await expect(getThemeDetail('nonexistent')).rejects.toThrow('HTTP 404');
  });
});

// ---------------------------------------------------------------------------
// describe: downloadTheme
// ---------------------------------------------------------------------------

describe('downloadTheme', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createMockReadableStream(chunks: Buffer[]): ReadableStream<Uint8Array> {
    let index = 0;
    return {
      getReader: () => ({
        read: async () => {
          if (index < chunks.length) {
            return { done: false, value: chunks[index++] };
          }
          return { done: true, value: undefined };
        },
        cancel: async () => {},
      }),
    } as ReadableStream<Uint8Array>;
  }

  it('downloads a theme ZIP as Buffer', async () => {
    const zipData = Buffer.from('PK\x03\x04fake-zip-content');
    const stream = createMockReadableStream([zipData]);

    const mockResponse = createMockResponse({
      ok: true,
      body: stream,
      headers: { 'Content-Length': String(zipData.length) },
    });
    mockFetch.mockResolvedValueOnce(mockResponse);

    const result = await downloadTheme('theme-001');

    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.toString()).toBe('PK\x03\x04fake-zip-content');
  });

  it('calls onProgress callback during download', async () => {
    const chunk1 = Buffer.from('chunk1-');
    const chunk2 = Buffer.from('chunk2-');
    const chunk3 = Buffer.from('chunk3');
    const totalSize = chunk1.length + chunk2.length + chunk3.length;
    const stream = createMockReadableStream([chunk1, chunk2, chunk3]);

    const mockResponse = createMockResponse({
      ok: true,
      body: stream,
      headers: { 'Content-Length': String(totalSize) },
    });
    mockFetch.mockResolvedValueOnce(mockResponse);

    const progressCalls: Array<[number, number]> = [];
    await downloadTheme('theme-001', (bytes, total) => {
      progressCalls.push([bytes, total]);
    });

    expect(progressCalls.length).toBeGreaterThan(0);
    // Last call should have full size
    expect(progressCalls[progressCalls.length - 1][0]).toBe(totalSize);
    expect(progressCalls[progressCalls.length - 1][1]).toBe(totalSize);
  });

  it('throws DreamSkinApiError for empty id', async () => {
    await expect(downloadTheme('')).rejects.toThrow(DreamSkinApiError);
    await expect(downloadTheme('')).rejects.toThrow('Invalid theme ID');
  });

  it('throws DreamSkinApiError on HTTP error', async () => {
    const mockResponse = createMockResponse({
      ok: false,
      status: 500,
    });
    mockFetch.mockResolvedValueOnce(mockResponse);

    await expect(downloadTheme('theme-001')).rejects.toThrow('HTTP 500');
  });

  it('throws DreamSkinApiError when Content-Length exceeds 50MB', async () => {
    const oversized = 50 * 1024 * 1024 + 1;
    const mockResponse = createMockResponse({
      ok: true,
      body: createMockReadableStream([]),
      headers: { 'Content-Length': String(oversized) },
    });
    mockFetch.mockResolvedValueOnce(mockResponse);

    await expect(downloadTheme('theme-001')).rejects.toThrow('exceeds 50MB');
  });

  it('throws DreamSkinApiError when response body is null', async () => {
    const mockResponse = createMockResponse({
      ok: true,
      body: null,
      headers: { 'Content-Length': '0' },
    });
    mockFetch.mockResolvedValueOnce(mockResponse);

    await expect(downloadTheme('theme-001')).rejects.toThrow('body reader');
  });

  it('throws DreamSkinApiError when download exceeds 50MB during streaming', async () => {
    // Content-Length is small but actual data exceeds limit
    const oversizedChunk = Buffer.alloc(50 * 1024 * 1024 + 1, 0x61);
    const stream = createMockReadableStream([oversizedChunk]);

    const mockResponse = createMockResponse({
      ok: true,
      body: stream,
      headers: { 'Content-Length': '100' }, // Lies about size
    });
    mockFetch.mockResolvedValueOnce(mockResponse);

    await expect(downloadTheme('theme-001')).rejects.toThrow('exceeds 50MB');
  });

  it('does not call onProgress when Content-Length is 0', async () => {
    const chunk = Buffer.from('data');
    const stream = createMockReadableStream([chunk]);

    const mockResponse = createMockResponse({
      ok: true,
      body: stream,
      headers: { 'Content-Length': '0' },
    });
    mockFetch.mockResolvedValueOnce(mockResponse);

    const onProgress = vi.fn();
    await downloadTheme('theme-001', onProgress);

    expect(onProgress).not.toHaveBeenCalled();
  });
});

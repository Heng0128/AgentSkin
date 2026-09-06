// SPDX-License-Identifier: MPL-2.0

/**
 * Unit tests for services/app-icon.ts
 *
 * Tests the icon extraction pipeline with mocked Electron APIs and filesystem.
 * The module has three fallback stages:
 *   1. PNG inside PE .rsrc section
 *   2. OS shell icon via app.getFileIcon
 *   3. Standalone .ico next to exe
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock electron BEFORE importing the module
vi.mock('electron', () => ({
  app: {
    getFileIcon: vi.fn(),
  },
  nativeImage: {
    createFromBuffer: vi.fn(),
  },
}));

// Mock fs/promises
vi.mock('node:fs/promises', () => ({
  default: {
    open: vi.fn(),
    readdir: vi.fn(),
  },
}));

import fs from 'node:fs/promises';
import { app, nativeImage } from 'electron';
import { extractAppIcon } from './app-icon';

const mockGetFileIcon = vi.mocked(app.getFileIcon);
const _mockCreateFromBuffer = vi.mocked(nativeImage.createFromBuffer);
const mockOpen = vi.mocked(fs.open);
const mockReaddir = vi.mocked(fs.readdir);

/**
 * Creates a mock FileHandle that simulates reading a PE file with no .rsrc section.
 */
function _createMockFileHandle(
  readImpl: (
    buf: Buffer,
    offset: number,
    length: number,
    position: number,
  ) => Promise<{ bytesRead: number }>,
) {
  return {
    read: vi.fn(async (buf: Buffer, offset: number, length: number, position: number) => {
      return readImpl(buf, offset, length, position);
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Creates a minimal PE file buffer with DOS header pointing to PE header.
 */
function createMinimalPeBuffer(): Buffer {
  const buf = Buffer.alloc(0x100);
  // DOS header e_lfanew at offset 0x3C
  buf.writeUInt32LE(0x80, 0x3c);
  // PE signature at offset 0x80
  buf.write('PE\0\0', 0x80, 4, 'ascii');
  // Number of sections = 0 at offset 0x86 (PE + 6)
  buf.writeUInt16LE(0, 0x86);
  // Size of optional header = 0 at offset 0x94 (PE + 20)
  buf.writeUInt16LE(0, 0x94);
  return buf;
}

describe('extractAppIcon', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('stage 1: PNG inside .rsrc section', () => {
    it('returns null when file cannot be opened', async () => {
      mockOpen.mockRejectedValue(new Error('file not found'));

      const result = await extractAppIcon('/nonexistent/app.exe');

      expect(result).toBeNull();
    });

    it('returns null when PE has no .rsrc section', async () => {
      const peBuf = createMinimalPeBuffer();
      const mockHandle = vi.fn().mockResolvedValue({
        read: vi.fn(async (buf: Buffer, _offset: number, length: number, position: number) => {
          peBuf.copy(buf, 0, position, position + length);
          return { bytesRead: length };
        }),
        close: vi.fn().mockResolvedValue(undefined),
      });
      mockOpen.mockResolvedValue(mockHandle as never);

      // Mock getFileIcon to return empty (stage 2 fallback)
      const emptyImage = { isEmpty: () => true, toDataURL: () => '' };
      mockGetFileIcon.mockResolvedValue(emptyImage as never);

      const result = await extractAppIcon('/test/app.exe');

      // Should fall through to stage 2
      expect(mockGetFileIcon).toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });

  describe('stage 2: OS shell icon', () => {
    it('returns data URL from getFileIcon when .rsrc has no PNG', async () => {
      // Mock file open to return PE without .rsrc
      const peBuf = createMinimalPeBuffer();
      mockOpen.mockResolvedValue({
        read: vi.fn(async (buf: Buffer, _offset: number, length: number, position: number) => {
          peBuf.copy(buf, 0, position, position + length);
          return { bytesRead: length };
        }),
        close: vi.fn().mockResolvedValue(undefined),
      } as never);

      // Mock getFileIcon to return valid icon
      const mockIcon = {
        isEmpty: () => false,
        toDataURL: () => 'data:image/png;base64,abc123',
      };
      mockGetFileIcon.mockResolvedValue(mockIcon as never);

      const result = await extractAppIcon('/test/app.exe');

      expect(result).toBe('data:image/png;base64,abc123');
    });

    it('returns null when getFileIcon throws', async () => {
      // Mock file open to return PE without .rsrc
      const peBuf = createMinimalPeBuffer();
      mockOpen.mockResolvedValue({
        read: vi.fn(async (buf: Buffer, _offset: number, length: number, position: number) => {
          peBuf.copy(buf, 0, position, position + length);
          return { bytesRead: length };
        }),
        close: vi.fn().mockResolvedValue(undefined),
      } as never);

      mockGetFileIcon.mockRejectedValue(new Error('shell error'));

      const result = await extractAppIcon('/test/app.exe');

      expect(result).toBeNull();
    });
  });

  describe('stage 3: standalone .ico fallback', () => {
    it('falls back to .ico file next to exe', async () => {
      // Mock file open to return PE without .rsrc
      const peBuf = createMinimalPeBuffer();
      mockOpen.mockResolvedValue({
        read: vi.fn(async (buf: Buffer, _offset: number, length: number, position: number) => {
          peBuf.copy(buf, 0, position, position + length);
          return { bytesRead: length };
        }),
        close: vi.fn().mockResolvedValue(undefined),
      } as never);

      // Stage 2 returns empty
      const emptyIcon = { isEmpty: () => true, toDataURL: () => '' };
      mockGetFileIcon.mockResolvedValueOnce(emptyIcon as never);

      // Stage 3: directory has .ico file
      mockReaddir.mockResolvedValue(['app.exe', 'app.ico'] as never);

      // Stage 3: getFileIcon for .ico returns valid icon
      const icoIcon = {
        isEmpty: () => false,
        toDataURL: () => 'data:image/x-icon;base64,ico123',
      };
      mockGetFileIcon.mockResolvedValueOnce(icoIcon as never);

      const result = await extractAppIcon('/test/app.exe');

      expect(result).toBe('data:image/x-icon;base64,ico123');
    });

    it('returns null when no .ico file exists', async () => {
      // Mock file open to return PE without .rsrc
      const peBuf = createMinimalPeBuffer();
      mockOpen.mockResolvedValue({
        read: vi.fn(async (buf: Buffer, _offset: number, length: number, position: number) => {
          peBuf.copy(buf, 0, position, position + length);
          return { bytesRead: length };
        }),
        close: vi.fn().mockResolvedValue(undefined),
      } as never);

      // Stage 2 returns empty
      const emptyIcon = { isEmpty: () => true, toDataURL: () => '' };
      mockGetFileIcon.mockResolvedValueOnce(emptyIcon as never);

      // Stage 3: directory has no .ico file
      mockReaddir.mockResolvedValue(['app.exe'] as never);

      const result = await extractAppIcon('/test/app.exe');

      expect(result).toBeNull();
    });
  });

  describe('error handling', () => {
    it('returns null when all stages fail', async () => {
      // Stage 1: file open fails
      mockOpen.mockRejectedValue(new Error('file not found'));

      // Stage 2: getFileIcon returns empty
      const emptyIcon = { isEmpty: () => true, toDataURL: () => '' };
      mockGetFileIcon.mockResolvedValue(emptyIcon as never);

      // Stage 3: readdir fails
      mockReaddir.mockRejectedValue(new Error('dir not found'));

      const result = await extractAppIcon('/test/app.exe');

      expect(result).toBeNull();
    });

    it('returns null for empty path', async () => {
      mockOpen.mockRejectedValue(new Error('invalid path'));

      const result = await extractAppIcon('');

      expect(result).toBeNull();
    });
  });
});

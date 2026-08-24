// SPDX-License-Identifier: MPL-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// We mock yauzl at the module level so tests don't touch the filesystem.
// Use vi.hoisted() so the mock variable is available inside the vi.mock factory
// (vi.mock is hoisted to the top of the file by the bundler).
const { yauzlOpenMock } = vi.hoisted(() => ({
  yauzlOpenMock: vi.fn(),
}));

vi.mock('yauzl', () => ({
  default: {
    open: yauzlOpenMock,
  },
}));

// Mock logger to prevent console noise during error-path tests.
vi.mock('../../src/main/logger', () => ({
  mainError: vi.fn(),
  mainWarn: vi.fn(),
  mainInfo: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Dynamic imports
// ---------------------------------------------------------------------------

import {
  extractThemeZip,
  cleanupExtractDir,
} from '../../src/main/community/community-zip-extractor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a mock yauzl ZipFile that emits the given entries sequentially.
 * Each entry is `{ fileName: string, isDirectory?: boolean }`.
 */
function createMockZipfile(
  entries: Array<{ fileName: string; isDirectory?: boolean }>,
  options: { entryCount?: number } = {},
): any {
  const entryHandlers: Array<(entry: any) => void> = [];
  const endHandlers: Array<() => void> = [];
  const errorHandlers: Array<(err: Error) => void> = [];

  const zipfile = {
    entryCount: options.entryCount ?? entries.length,
    readEntry: vi.fn(),
    close: vi.fn(),
    openReadStream: vi.fn(),
    on: vi.fn().mockImplementation((event: string, handler: any) => {
      if (event === 'entry') entryHandlers.push(handler);
      if (event === 'end') endHandlers.push(handler);
      if (event === 'error') errorHandlers.push(handler);
    }),
    // Helper to drive the mock: emit all entries then end
    _emitEntries() {
      let i = 0;
      const next = () => {
        if (i < entries.length) {
          const entry = entries[i++];
          // For directory entries, just call handler and advance.
          // For file entries, set up openReadStream mock.
          if (!entry.isDirectory) {
            zipfile.openReadStream.mockImplementationOnce((_e: any, cb: any) => {
              const readStream = {
                on: vi.fn().mockImplementation((evt: string, h: any) => {
                  if (evt === 'data') {
                    // Store data handler for later emission
                    readStream._dataHandler = h;
                  }
                  if (evt === 'end') readStream._endHandler = h;
                }),
                pipe: vi.fn().mockImplementation((dest: any) => {
                  // Simulate piping: when write stream finishes, call end
                  readStream._pipeDest = dest;
                }),
                _dataHandler: null as any,
                _endHandler: null as any,
                _pipeDest: null as any,
              };
              cb(null, readStream);
            });
          }
          // Schedule entry emission on next tick to mimic async behavior
          process.nextTick(() => {
            for (const h of entryHandlers) h(entry);
          });
        } else {
          process.nextTick(() => {
            for (const h of endHandlers) h();
          });
        }
      };
      // Wire readEntry to advance to next entry
      zipfile.readEntry.mockImplementation(() => next());
      // Kick off
      next();
    },
  };

  return zipfile;
}

// ---------------------------------------------------------------------------
// cleanupExtractDir
// ---------------------------------------------------------------------------

describe('cleanupExtractDir', () => {
  it('removes an existing temp directory with contents', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-cleanup-'));
    fs.writeFileSync(path.join(tempDir, 'test.txt'), 'hello');
    fs.mkdirSync(path.join(tempDir, 'subdir'));
    fs.writeFileSync(path.join(tempDir, 'subdir', 'nested.txt'), 'world');

    cleanupExtractDir(tempDir);

    expect(fs.existsSync(tempDir)).toBe(false);
  });

  it('does not throw for a non-existent directory', () => {
    expect(() => cleanupExtractDir('/nonexistent/path/that/does/not/exist')).not.toThrow();
  });

  it('does not throw for an already-cleaned directory (idempotent)', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-cleanup-'));
    cleanupExtractDir(tempDir);
    expect(() => cleanupExtractDir(tempDir)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// extractThemeZip — security tests
// ---------------------------------------------------------------------------

describe('extractThemeZip — security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects ZIP with too many entries (>1000)', async () => {
    const zipfile = {
      entryCount: 1001,
      readEntry: vi.fn(),
      close: vi.fn(),
      on: vi.fn(),
      openReadStream: vi.fn(),
    };

    yauzlOpenMock.mockImplementation(
      (_p: string, _o: any, cb: (err: Error | null, zf: any) => void) => {
        cb(null, zipfile);
      },
    );

    await expect(extractThemeZip('/fake/path.zip')).rejects.toThrow(
      /too many entries/,
    );
    expect(zipfile.close).toHaveBeenCalled();
  });

  it('rejects path traversal via ../ sequence', async () => {
    const zipfile = createMockZipfile([
      { fileName: '../../../etc/passwd' },
    ]);

    yauzlOpenMock.mockImplementation(
      (_p: string, _o: any, cb: (err: Error | null, zf: any) => void) => {
        cb(null, zipfile);
        zipfile._emitEntries();
      },
    );

    await expect(extractThemeZip('/fake/path.zip')).rejects.toThrow(
      /Path traversal/,
    );
  });

  it('rejects path traversal via absolute path', async () => {
    const zipfile = createMockZipfile([
      { fileName: '/etc/shadow' },
    ]);

    yauzlOpenMock.mockImplementation(
      (_p: string, _o: any, cb: (err: Error | null, zf: any) => void) => {
        cb(null, zipfile);
        zipfile._emitEntries();
      },
    );

    await expect(extractThemeZip('/fake/path.zip')).rejects.toThrow(
      /Path traversal/,
    );
  });

  it('rejects path traversal via encoded backslash (Windows-style)', async () => {
    const zipfile = createMockZipfile([
      { fileName: '..\\..\\windows\\system32\\config\\sam' },
    ]);

    yauzlOpenMock.mockImplementation(
      (_p: string, _o: any, cb: (err: Error | null, zf: any) => void) => {
        cb(null, zipfile);
        zipfile._emitEntries();
      },
    );

    await expect(extractThemeZip('/fake/path.zip')).rejects.toThrow(
      /Path traversal/,
    );
  });

  it('rejects path traversal via null byte injection', async () => {
    const zipfile = createMockZipfile([
      { fileName: 'theme.json\x00/../../../etc/passwd' },
    ]);

    yauzlOpenMock.mockImplementation(
      (_p: string, _o: any, cb: (err: Error | null, zf: any) => void) => {
        cb(null, zipfile);
        zipfile._emitEntries();
      },
    );

    // Null byte in filename — path.resolve will include it, but the
    // resolved path should still escape the temp dir.
    await expect(extractThemeZip('/fake/path.zip')).rejects.toThrow(
      /Path traversal/,
    );
  });

  it('cleans up temp dir on extraction failure', async () => {
    const realMkdtemp = fsp.mkdtemp;
    const createdDirs: string[] = [];

    // Spy on fsp.mkdtemp to track created temp dirs
    vi.spyOn(fsp, 'mkdtemp').mockImplementation(async (prefix: string) => {
      const dir = realMkdtemp(prefix);
      createdDirs.push(dir);
      return dir;
    });

    const zipfile = createMockZipfile([
      { fileName: '../../../etc/passwd' },
    ]);

    yauzlOpenMock.mockImplementation(
      (_p: string, _o: any, cb: (err: Error | null, zf: any) => void) => {
        cb(null, zipfile);
        zipfile._emitEntries();
      },
    );

    await expect(extractThemeZip('/fake/path.zip')).rejects.toThrow();

    // The temp dir should have been cleaned up
    for (const dir of createdDirs) {
      expect(fs.existsSync(dir)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// extractThemeZip — happy path
// ---------------------------------------------------------------------------

describe('extractThemeZip — happy path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts a valid ZIP with theme.json at root', async () => {
    // Mock yauzl to emit a single file entry with known content.
    // Let extractThemeZip create its own temp dir (don't mock fsp.mkdtemp).
    const zipfile = {
      entryCount: 1,
      readEntry: vi.fn(),
      close: vi.fn(),
      on: vi.fn(),
      openReadStream: vi.fn(),
    };

    const entryHandlers: Array<(entry: any) => void> = [];
    const endHandlers: Array<() => void> = [];
    let capturedTempDir: string | null = null;

    zipfile.on.mockImplementation((event: string, handler: any) => {
      if (event === 'entry') entryHandlers.push(handler);
      if (event === 'end') endHandlers.push(handler);
    });

    zipfile.readEntry.mockImplementation(() => {
      process.nextTick(() => {
        for (const h of endHandlers) h();
      });
    });

    zipfile.openReadStream.mockImplementation((e: any, cb: any) => {
      const content = Buffer.from('{"name": "test-theme"}');
      const readStream = {
        on: vi.fn().mockImplementation((evt: string, h: any) => {
          if (evt === 'end') process.nextTick(() => h());
        }),
        pipe: vi.fn().mockImplementation((dest: any) => {
          // dest is a WriteStream — write content and signal finish
          dest.write(content, () => {
            dest.end();
          });
        }),
      };
      cb(null, readStream);
    });

    yauzlOpenMock.mockImplementation(
      (_p: string, _o: any, cb: (err: Error | null, zf: any) => void) => {
        cb(null, zipfile);
        process.nextTick(() => {
          for (const h of entryHandlers) h({ fileName: 'theme.json' });
        });
      },
    );

    const result = await extractThemeZip('/fake/path.zip');

    // Verify the result points to a valid extraction
    expect(result.extractDir).toBeTruthy();
    expect(result.themeRoot).toBeTruthy();
    expect(result.extractDir).toBe(result.themeRoot);
    expect(fs.existsSync(path.join(result.themeRoot, 'theme.json'))).toBe(true);

    // Cleanup
    cleanupExtractDir(result.extractDir);
  });

  it('finds theme.json in a subdirectory (wrapper folder)', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-extract-'));
    const subDir = path.join(tempDir, 'my-theme');
    fs.mkdirSync(subDir);
    fs.writeFileSync(path.join(subDir, 'theme.json'), '{"name": "test"}');

    vi.spyOn(fsp, 'mkdtemp').mockResolvedValue(tempDir);

    const zipfile = {
      entryCount: 2,
      readEntry: vi.fn(),
      close: vi.fn(),
      on: vi.fn(),
      openReadStream: vi.fn(),
    };

    const entryHandlers: Array<(entry: any) => void> = [];
    const endHandlers: Array<() => void> = [];

    zipfile.on.mockImplementation((event: string, handler: any) => {
      if (event === 'entry') entryHandlers.push(handler);
      if (event === 'end') endHandlers.push(handler);
    });

    let entryCount = 0;
    zipfile.readEntry.mockImplementation(() => {
      entryCount++;
      if (entryCount >= 2) {
        process.nextTick(() => {
          for (const h of endHandlers) h();
        });
      }
    });

    zipfile.openReadStream.mockImplementation((_e: any, cb: any) => {
      const readStream = {
        on: vi.fn().mockImplementation((evt: string, h: any) => {
          if (evt === 'end') process.nextTick(() => h());
        }),
        pipe: vi.fn().mockImplementation((dest: any) => {
          process.nextTick(() => dest.emit('finish'));
        }),
      };
      cb(null, readStream);
    });

    yauzlOpenMock.mockImplementation(
      (_p: string, _o: any, cb: (err: Error | null, zf: any) => void) => {
        cb(null, zipfile);
        process.nextTick(() => {
          for (const h of entryHandlers) {
            h({ fileName: 'my-theme/' });
            h({ fileName: 'my-theme/theme.json' });
          }
        });
      },
    );

    const result = await extractThemeZip('/fake/path.zip');

    expect(result.themeRoot).toBe(subDir);

    // Cleanup
    cleanupExtractDir(tempDir);
  });

  it('rejects ZIP with no theme.json anywhere', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-extract-'));
    vi.spyOn(fsp, 'mkdtemp').mockResolvedValue(tempDir);

    const zipfile = {
      entryCount: 1,
      readEntry: vi.fn(),
      close: vi.fn(),
      on: vi.fn(),
      openReadStream: vi.fn(),
    };

    const entryHandlers: Array<(entry: any) => void> = [];
    const endHandlers: Array<() => void> = [];

    zipfile.on.mockImplementation((event: string, handler: any) => {
      if (event === 'entry') entryHandlers.push(handler);
      if (event === 'end') endHandlers.push(handler);
    });

    zipfile.readEntry.mockImplementation(() => {
      process.nextTick(() => {
        for (const h of endHandlers) h();
      });
    });

    zipfile.openReadStream.mockImplementation((_e: any, cb: any) => {
      const readStream = {
        on: vi.fn().mockImplementation((evt: string, h: any) => {
          if (evt === 'end') process.nextTick(() => h());
        }),
        pipe: vi.fn().mockImplementation((dest: any) => {
          process.nextTick(() => dest.emit('finish'));
        }),
      };
      cb(null, readStream);
    });

    yauzlOpenMock.mockImplementation(
      (_p: string, _o: any, cb: (err: Error | null, zf: any) => void) => {
        cb(null, zipfile);
        process.nextTick(() => {
          for (const h of entryHandlers) {
            h({ fileName: 'readme.txt' });
          }
        });
      },
    );

    await expect(extractThemeZip('/fake/path.zip')).rejects.toThrow(
      /No valid theme root found/,
    );

    // Cleanup
    cleanupExtractDir(tempDir);
  });
});

// ---------------------------------------------------------------------------
// extractThemeZip — error handling
// ---------------------------------------------------------------------------

describe('extractThemeZip — error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects when yauzl.open returns an error', async () => {
    yauzlOpenMock.mockImplementation(
      (_p: string, _o: any, cb: (err: Error | null, zf: any) => void) => {
        cb(new Error('Corrupt ZIP file'), null);
      },
    );

    await expect(extractThemeZip('/fake/path.zip')).rejects.toThrow(
      /Failed to open ZIP/,
    );
  });

  it('rejects when yauzl emits an error event', async () => {
    const zipfile = {
      entryCount: 0,
      readEntry: vi.fn(),
      close: vi.fn(),
      on: vi.fn(),
      openReadStream: vi.fn(),
    };

    const errorHandlers: Array<(err: Error) => void> = [];

    zipfile.on.mockImplementation((event: string, handler: any) => {
      if (event === 'error') errorHandlers.push(handler);
    });

    yauzlOpenMock.mockImplementation(
      (_p: string, _o: any, cb: (err: Error | null, zf: any) => void) => {
        cb(null, zipfile);
        // Emit error after a tick
        process.nextTick(() => {
          for (const h of errorHandlers) h(new Error('ZIP read error'));
        });
      },
    );

    await expect(extractThemeZip('/fake/path.zip')).rejects.toThrow(
      /ZIP processing error/,
    );
  });

  it('rejects when openReadStream fails for an entry', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-extract-'));
    vi.spyOn(fsp, 'mkdtemp').mockResolvedValue(tempDir);

    const zipfile = {
      entryCount: 1,
      readEntry: vi.fn(),
      close: vi.fn(),
      on: vi.fn(),
      openReadStream: vi.fn(),
    };

    const entryHandlers: Array<(entry: any) => void> = [];
    const endHandlers: Array<() => void> = [];

    zipfile.on.mockImplementation((event: string, handler: any) => {
      if (event === 'entry') entryHandlers.push(handler);
      if (event === 'end') endHandlers.push(handler);
    });

    zipfile.openReadStream.mockImplementation((_e: any, cb: any) => {
      cb(new Error('CRC mismatch'), null);
    });

    yauzlOpenMock.mockImplementation(
      (_p: string, _o: any, cb: (err: Error | null, zf: any) => void) => {
        cb(null, zipfile);
        process.nextTick(() => {
          for (const h of entryHandlers) {
            h({ fileName: 'theme.json' });
          }
        });
      },
    );

    await expect(extractThemeZip('/fake/path.zip')).rejects.toThrow(
      /Failed to read entry/,
    );

    // Cleanup
    cleanupExtractDir(tempDir);
  });
});

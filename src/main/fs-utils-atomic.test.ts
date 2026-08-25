// SPDX-License-Identifier: MPL-2.0

import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * These tests exercise the fsync protocol in atomicWriteFile / atomicWriteJson /
 * atomicWriteJsonSync.
 *
 * Mock strategy:
 *   - `node:fs/promises`: only `rename` and `open` are replaced with vi.fn
 *     wrapping the originals. This lets us drive the rename-failure cleanup
 *     branch and the write-failure branch while keeping every other method
 *     (FileHandle.write, FileHandle.sync, FileHandle.close) real — so we test
 *     the genuine open→write→sync→close sequence on the temp file.
 *   - `node:fs`: NOT mocked. For `atomicWriteJsonSync` tests we use
 *     `vi.spyOn(fs, 'methodName')` directly on the real module. This avoids
 *     the CJS interop issues with vi.mock + vi.mocked and gives us reliable
 *     spies for verifying the fsync call order.
 */

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const ns = {
    ...actual,
    rename: vi.fn(actual.rename),
    open: vi.fn(actual.open),
  };
  return { ...ns, default: ns };
});

import fs from 'node:fs';
import fsP from 'node:fs/promises';
import { atomicWriteFile, atomicWriteJson, atomicWriteJsonSync, DiskFullError } from './fs-utils';

describe('atomicWriteJson (async)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fsP.mkdtemp(path.join(os.tmpdir(), 'agentskin-atomic-'));
  });

  afterEach(async () => {
    await fsP.rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('writes JSON with trailing newline and pretty-print', async () => {
    const file = path.join(tmpDir, 'config.json');
    await atomicWriteJson(file, { x: 1, y: [2, 3] });
    const raw = await fsP.readFile(file, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(JSON.parse(raw)).toEqual({ x: 1, y: [2, 3] });
    expect(raw).toContain('  "x": 1');
  });

  it('creates nested parent directories as needed', async () => {
    const file = path.join(tmpDir, 'deep', 'nested', 'config.json');
    await atomicWriteJson(file, { nested: true });
    expect(await fsP.readFile(file, 'utf8')).toContain('"nested": true');
  });

  it('overwrites an existing file atomically', async () => {
    const file = path.join(tmpDir, 'state.json');
    await atomicWriteJson(file, { v: 1 });
    await atomicWriteJson(file, { v: 2 });
    expect(JSON.parse(await fsP.readFile(file, 'utf8'))).toEqual({ v: 2 });
  });

  it('leaves the original file intact when rename fails', async () => {
    const file = path.join(tmpDir, 'state.json');
    await atomicWriteJson(file, { v: 1 });
    vi.mocked(fsP.rename).mockRejectedValueOnce(new Error('rename EPERM'));

    await expect(atomicWriteJson(file, { v: 2 })).rejects.toThrow('rename EPERM');
    // Original value preserved.
    expect(JSON.parse(await fsP.readFile(file, 'utf8'))).toEqual({ v: 1 });
    // Temp file cleaned up.
    const leftovers = (await fsP.readdir(tmpDir)).filter(
      (n) => n.startsWith('.state.json.') && n.endsWith('.tmp'),
    );
    expect(leftovers).toHaveLength(0);
  });

  it('cleans up temp file when the initial write fails', async () => {
    // Force fsP.open to fail so the temp file is never created.
    vi.mocked(fsP.open).mockRejectedValueOnce(new Error('open EACCES'));
    const file = path.join(tmpDir, 'config.json');
    await expect(atomicWriteJson(file, { v: 1 })).rejects.toThrow('open EACCES');
  });

  it('throws DiskFullError with Chinese message on ENOSPC during rename', async () => {
    const file = path.join(tmpDir, 'state.json');
    const enospcError = new Error('No space left on device') as NodeJS.ErrnoException;
    enospcError.code = 'ENOSPC';
    vi.mocked(fsP.rename).mockRejectedValueOnce(enospcError);

    await expect(atomicWriteJson(file, { v: 1 })).rejects.toThrow(DiskFullError);
  });
});

describe('atomicWriteFile (async, raw bytes)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fsP.mkdtemp(path.join(os.tmpdir(), 'agentskin-raw-'));
  });

  afterEach(async () => {
    await fsP.rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('writes a Buffer byte-for-byte', async () => {
    const file = path.join(tmpDir, 'theme.agentskin-theme');
    const payload = Buffer.from('{"format":"agentskin-theme","version":1}', 'utf8');
    await atomicWriteFile(file, payload);
    const raw = await fsP.readFile(file, 'utf8');
    expect(raw).toBe('{"format":"agentskin-theme","version":1}');
  });

  it('supports string content', async () => {
    const file = path.join(tmpDir, 'plain.txt');
    await atomicWriteFile(file, 'hello world');
    expect(await fsP.readFile(file, 'utf8')).toBe('hello world');
  });
});

describe('atomicWriteJsonSync', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentskin-atomic-sync-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('writes pretty-printed JSON with trailing newline', () => {
    const file = path.join(tmpDir, 'config.json');
    atomicWriteJsonSync(file, { a: 1 });
    const raw = fs.readFileSync(file, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(JSON.parse(raw)).toEqual({ a: 1 });
    expect(raw).toContain('  "a": 1');
  });

  it('calls fsyncSync on the temp file before renameSync', () => {
    const file = path.join(tmpDir, 'config.json');
    const callOrder: string[] = [];

    // Capture real functions BEFORE spying so the spies can delegate to them.
    const realOpenSync = fs.openSync.bind(fs);
    const realWriteSync = fs.writeSync.bind(fs);
    const realFsyncSync = fs.fsyncSync.bind(fs);
    const realRenameSync = fs.renameSync.bind(fs);
    const realCloseSync = fs.closeSync.bind(fs);

    // Spy on all relevant fs sync methods. Each spy calls the real implementation
    // and pushes a tag to callOrder so we can verify sequencing.
    vi.spyOn(fs, 'openSync').mockImplementation((...args) => {
      callOrder.push('openSync');
      return realOpenSync(...(args as Parameters<typeof fs.openSync>));
    });
    vi.spyOn(fs, 'writeSync').mockImplementation((...args) => {
      callOrder.push('writeSync');
      return realWriteSync(...(args as Parameters<typeof fs.writeSync>));
    });
    vi.spyOn(fs, 'fsyncSync').mockImplementation((...args) => {
      callOrder.push('fsyncSync');
      return realFsyncSync(...(args as Parameters<typeof fs.fsyncSync>));
    });
    vi.spyOn(fs, 'renameSync').mockImplementation((...args) => {
      callOrder.push('renameSync');
      return realRenameSync(...(args as Parameters<typeof fs.renameSync>));
    });
    vi.spyOn(fs, 'closeSync').mockImplementation((...args) => {
      callOrder.push('closeSync');
      return realCloseSync(...(args as Parameters<typeof fs.closeSync>));
    });

    atomicWriteJsonSync(file, { ordered: true });

    // The protocol requires: fsyncSync happens BEFORE renameSync.
    const fsyncIdx = callOrder.indexOf('fsyncSync');
    const renameIdx = callOrder.indexOf('renameSync');
    const closeIdx = callOrder.indexOf('closeSync');
    expect(fsyncIdx).toBeGreaterThan(-1);
    expect(renameIdx).toBeGreaterThan(-1);
    expect(closeIdx).toBeGreaterThan(-1);
    // Temp file is closed before rename.
    expect(closeIdx).toBeLessThan(renameIdx);
    // Temp file is fsync'd before it's closed.
    expect(fsyncIdx).toBeLessThan(closeIdx);
  });

  it('calls fsyncDirSync after renameSync to persist directory entry', () => {
    const file = path.join(tmpDir, 'config.json');
    const callOrder: string[] = [];

    const realRenameSync = fs.renameSync.bind(fs);
    const realFsyncSync = fs.fsyncSync.bind(fs);
    const realOpenSync = fs.openSync.bind(fs);
    const realCloseSync = fs.closeSync.bind(fs);

    vi.spyOn(fs, 'openSync').mockImplementation((...args) => {
      callOrder.push('openSync');
      return realOpenSync(...(args as Parameters<typeof fs.openSync>));
    });
    vi.spyOn(fs, 'fsyncSync').mockImplementation((...args) => {
      callOrder.push('fsyncSync');
      return realFsyncSync(...(args as Parameters<typeof fs.fsyncSync>));
    });
    vi.spyOn(fs, 'renameSync').mockImplementation((...args) => {
      callOrder.push('renameSync');
      return realRenameSync(...(args as Parameters<typeof fs.renameSync>));
    });
    vi.spyOn(fs, 'closeSync').mockImplementation((...args) => {
      callOrder.push('closeSync');
      return realCloseSync(...(args as Parameters<typeof fs.closeSync>));
    });

    atomicWriteJsonSync(file, { dirFsync: true });

    // Two fsyncSync calls: one for the temp file, one for the parent directory.
    // The last fsyncSync must come AFTER renameSync.
    const renameIdx = callOrder.indexOf('renameSync');
    const lastFsyncIdx = callOrder.lastIndexOf('fsyncSync');
    const firstFsyncIdx = callOrder.indexOf('fsyncSync');
    expect(renameIdx).toBeGreaterThan(-1);
    // Temp-file fsync comes before rename.
    expect(firstFsyncIdx).toBeLessThan(renameIdx);
    // Dir-fsync comes after rename.
    expect(lastFsyncIdx).toBeGreaterThan(renameIdx);
  });

  it('overwrites an existing file atomically', () => {
    const file = path.join(tmpDir, 'state.json');
    atomicWriteJsonSync(file, { v: 1 });
    atomicWriteJsonSync(file, { v: 2 });
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ v: 2 });
  });

  it('leaves original intact and cleans temp file when renameSync fails', () => {
    const file = path.join(tmpDir, 'state.json');
    atomicWriteJsonSync(file, { v: 1 });

    const realRenameSync = fs.renameSync.bind(fs);
    vi.spyOn(fs, 'renameSync').mockImplementation((...args) => {
      // Fail only the first call (the actual rename), not other renameSync uses.
      if (args[0] === `${file}.${process.pid}` || String(args[0]).endsWith('.tmp')) {
        throw new Error('rename EPERM');
      }
      return realRenameSync(...(args as Parameters<typeof fs.renameSync>));
    });

    expect(() => atomicWriteJsonSync(file, { v: 2 })).toThrow('rename EPERM');
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ v: 1 });
    const leftovers = fs
      .readdirSync(tmpDir)
      .filter((n) => n.startsWith('.state.json.') && n.endsWith('.tmp'));
    expect(leftovers).toHaveLength(0);
  });

  it('creates nested parent directories as needed', () => {
    const file = path.join(tmpDir, 'deep', 'nested', 'config.json');
    atomicWriteJsonSync(file, { nested: true });
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ nested: true });
  });

  it('throws DiskFullError on ENOSPC during renameSync', () => {
    const file = path.join(tmpDir, 'state.json');
    // Force renameSync to throw ENOSPC.
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      const err = new Error('No space left on device') as NodeJS.ErrnoException;
      err.code = 'ENOSPC';
      throw err;
    });

    expect(() => atomicWriteJsonSync(file, { v: 1 })).toThrow(DiskFullError);
  });
});

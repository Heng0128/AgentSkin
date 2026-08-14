// SPDX-License-Identifier: MPL-2.0

import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * fs-utils imports `fs from 'node:fs/promises'` (default import of the
 * namespace). We mock the module with importActual so every method stays real
 * except `rename`, which becomes a controllable vi.fn — this lets us drive the
 * rename-failure cleanup branch (lines 39-41) that a real filesystem won't
 * produce reliably.
 */
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const ns = { ...actual, rename: vi.fn(actual.rename) };
  return { ...ns, default: ns };
});

import fs from 'node:fs/promises';
import { appendLogLine, DiskFullError, writeJsonAtomic } from './fs-utils';

describe('writeJsonAtomic', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-fs-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('writes pretty-printed JSON with a trailing newline', async () => {
    const file = path.join(tmpDir, 'state.json');
    await writeJsonAtomic(file, { a: 1, b: [2, 3] });
    const raw = await fs.readFile(file, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(JSON.parse(raw)).toEqual({ a: 1, b: [2, 3] });
    // Pretty-printed (2-space indent).
    expect(raw).toContain('  "a": 1');
  });

  it('creates nested parent directories that do not exist yet', async () => {
    const file = path.join(tmpDir, 'nested', 'deep', 'state.json');
    await writeJsonAtomic(file, { ok: true });
    expect(await fs.readFile(file, 'utf8')).toContain('"ok": true');
  });

  it('overwrites an existing file atomically (rename onto target)', async () => {
    const file = path.join(tmpDir, 'state.json');
    await writeJsonAtomic(file, { v: 1 });
    await writeJsonAtomic(file, { v: 2 });
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ v: 2 });
  });

  it('cleans up the temp file and rethrows when rename fails', async () => {
    vi.mocked(fs.rename).mockRejectedValueOnce(new Error('rename EPERM'));
    const file = path.join(tmpDir, 'state.json');

    await expect(writeJsonAtomic(file, { v: 1 })).rejects.toThrow('rename EPERM');
    // The temp file (.<basename>.<pid>.<rand>.tmp) must not be left behind.
    const entries = await fs.readdir(tmpDir);
    const leftoverTmp = entries.filter(
      (name) => name.startsWith('.state.json.') && name.endsWith('.tmp'),
    );
    expect(leftoverTmp).toHaveLength(0);
  });

  it('throws DiskFullError with Chinese message when writeFile hits ENOSPC', async () => {
    const enospcError = new Error('No space left on device') as NodeJS.ErrnoException;
    enospcError.code = 'ENOSPC';
    vi.mocked(fs.writeFile).mockRejectedValueOnce(enospcError);

    const file = path.join(tmpDir, 'state.json');
    await expect(writeJsonAtomic(file, { v: 1 })).rejects.toThrow(DiskFullError);

    try {
      await writeJsonAtomic(file, { v: 1 });
    } catch (e) {
      expect(e).toBeInstanceOf(DiskFullError);
      expect((e as DiskFullError).code).toBe('ENOSPC');
      expect((e as DiskFullError).message).toContain('磁盘空间不足');
      expect((e as DiskFullError).filePath).toBe(file);
    }
  });

  it('throws DiskFullError when rename hits ENOSPC', async () => {
    const enospcError = new Error('No space left on device') as NodeJS.ErrnoException;
    enospcError.code = 'ENOSPC';
    vi.mocked(fs.rename).mockRejectedValueOnce(enospcError);

    const file = path.join(tmpDir, 'state.json');
    await expect(writeJsonAtomic(file, { v: 1 })).rejects.toThrow(DiskFullError);
  });
});

describe('appendLogLine', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-log-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('appends a line, creating parent directories as needed', async () => {
    const file = path.join(tmpDir, 'logs', 'app.log');
    await appendLogLine(file, 'first\n');
    await appendLogLine(file, 'second\n');
    expect(await fs.readFile(file, 'utf8')).toBe('first\nsecond\n');
  });

  it('never throws when the target path is unwritable', async () => {
    // Pointing at a path whose parent is an existing file makes mkdir fail.
    const blocker = path.join(tmpDir, 'blocker');
    await fs.writeFile(blocker, 'x');
    const file = path.join(blocker, 'nested', 'app.log');
    await expect(appendLogLine(file, 'ignored\n')).resolves.toBeUndefined();
  });
});

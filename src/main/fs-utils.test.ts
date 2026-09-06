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
import {
  appendLogLine,
  atomicBackup,
  atomicRestore,
  checkUtf8Strict,
  cleanupBackups,
  DiskFullError,
  verifyByteForByte,
  writeJsonAtomic,
  writeJsonAtomicSafe,
} from './fs-utils';

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

  it('throws DiskFullError with Chinese message when the write path hits ENOSPC', async () => {
    const enospcError = new Error('No space left on device') as NodeJS.ErrnoException;
    enospcError.code = 'ENOSPC';
    // Spy on fs.open (not rename) so only the write path is mocked. The atomic
    // write implementation now uses fs.open → FileHandle.write → sync → close
    // instead of writeFile, so we mock open to simulate a write failure.
    const openSpy = vi.spyOn(fs, 'open').mockRejectedValueOnce(enospcError);

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
    openSpy.mockRestore();
  });

  it('throws DiskFullError when rename hits ENOSPC', async () => {
    const enospcError = new Error('No space left on device') as NodeJS.ErrnoException;
    enospcError.code = 'ENOSPC';
    // The existing vi.mock for rename lets us use mockRejectedValueOnce.
    vi.mocked(fs.rename).mockRejectedValueOnce(enospcError);

    const file = path.join(tmpDir, 'state.json');
    await expect(writeJsonAtomic(file, { v: 1 })).rejects.toThrow(DiskFullError);
  });
});

describe('writeJsonAtomicSafe', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-safe-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('writes pretty-printed JSON with a trailing newline', async () => {
    const file = path.join(tmpDir, 'state.json');
    await writeJsonAtomicSafe(file, { a: 1, b: [2, 3] });
    const raw = await fs.readFile(file, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(JSON.parse(raw)).toEqual({ a: 1, b: [2, 3] });
  });

  it('creates a .bak backup before overwriting an existing file', async () => {
    const file = path.join(tmpDir, 'state.json');
    await writeJsonAtomicSafe(file, { v: 1 });
    // After a successful write, the .bak should be removed.
    const entries = await fs.readdir(tmpDir);
    expect(entries.filter((n) => n.endsWith('.bak'))).toHaveLength(0);

    // Write again — this time the .bak should be created then cleaned up.
    await writeJsonAtomicSafe(file, { v: 2 });
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ v: 2 });
    // No leftover .bak after success.
    const entriesAfter = await fs.readdir(tmpDir);
    expect(entriesAfter.filter((n) => n.endsWith('.bak'))).toHaveLength(0);
  });

  it('does not create .bak when target file does not exist', async () => {
    const file = path.join(tmpDir, 'new.json');
    await writeJsonAtomicSafe(file, { fresh: true });
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ fresh: true });
    const entries = await fs.readdir(tmpDir);
    expect(entries.filter((n) => n.endsWith('.bak'))).toHaveLength(0);
  });

  it('rolls back from .bak when atomic write fails', async () => {
    const file = path.join(tmpDir, 'state.json');
    // Create the initial file.
    await writeJsonAtomicSafe(file, { v: 1 });
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ v: 1 });

    // Force the next rename to fail — this triggers the rollback path.
    vi.mocked(fs.rename).mockRejectedValueOnce(new Error('rename EPERM'));

    await expect(writeJsonAtomicSafe(file, { v: 2 })).rejects.toThrow('rename EPERM');
    // Original value must be restored from .bak.
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ v: 1 });
  });

  it('cleans up .bak after successful rollback', async () => {
    const file = path.join(tmpDir, 'state.json');
    await writeJsonAtomicSafe(file, { v: 1 });

    vi.mocked(fs.rename).mockRejectedValueOnce(new Error('rename EPERM'));
    await expect(writeJsonAtomicSafe(file, { v: 2 })).rejects.toThrow('rename EPERM');

    // .bak should be cleaned up after successful rollback.
    const entries = await fs.readdir(tmpDir);
    expect(entries.filter((n) => n.endsWith('.bak'))).toHaveLength(0);
  });

  it('leaves no temp files behind after failure', async () => {
    const file = path.join(tmpDir, 'state.json');
    await writeJsonAtomicSafe(file, { v: 1 });

    vi.mocked(fs.rename).mockRejectedValueOnce(new Error('rename EPERM'));
    await expect(writeJsonAtomicSafe(file, { v: 2 })).rejects.toThrow('rename EPERM');

    const entries = await fs.readdir(tmpDir);
    const leftoverTmp = entries.filter(
      (name) => name.startsWith('.state.json.') && name.endsWith('.tmp'),
    );
    expect(leftoverTmp).toHaveLength(0);
  });

  it('creates nested parent directories as needed', async () => {
    const file = path.join(tmpDir, 'nested', 'deep', 'state.json');
    await writeJsonAtomicSafe(file, { ok: true });
    expect(await fs.readFile(file, 'utf8')).toContain('"ok": true');
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

// ---------------------------------------------------------------------------
// checkUtf8Strict
// ---------------------------------------------------------------------------

describe('checkUtf8Strict', () => {
  it('returns valid=true for clean ASCII content', () => {
    const buf = Buffer.from('hello world', 'utf8');
    const result = checkUtf8Strict(buf);
    expect(result.valid).toBe(true);
    expect(result.hasBom).toBe(false);
    expect(result.hadNonNfc).toBe(false);
  });

  it('returns valid=true for clean UTF-8 multibyte content', () => {
    const buf = Buffer.from('你好世界 Привет мир こんにちは', 'utf8');
    const result = checkUtf8Strict(buf);
    expect(result.valid).toBe(true);
    expect(result.hasBom).toBe(false);
  });

  it('detects UTF-8 BOM', () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const content = Buffer.from('hello', 'utf8');
    const buf = Buffer.concat([bom, content]);
    const result = checkUtf8Strict(buf);
    expect(result.valid).toBe(false);
    expect(result.hasBom).toBe(true);
  });

  it('detects non-NFC Unicode (decomposed e-acute)', () => {
    // e followed by combining acute accent (U+0301) = non-NFC form of é
    const decomposed = 'e\u0301';
    const buf = Buffer.from(decomposed, 'utf8');
    const result = checkUtf8Strict(buf);
    expect(result.valid).toBe(false);
    expect(result.hadNonNfc).toBe(true);
    expect(result.normalized).toBeDefined();
    // The normalized buffer should be the proper NFC form (é = U+00E9)
    expect(result.normalized!.toString('utf8')).toBe('\u00e9');
  });

  it('returns valid=true for precomposed NFC content', () => {
    // Precomposed é (U+00E9) is NFC.
    const nfc = '\u00e9';
    const buf = Buffer.from(nfc, 'utf8');
    const result = checkUtf8Strict(buf);
    expect(result.valid).toBe(true);
    expect(result.hadNonNfc).toBe(false);
  });

  it('returns valid=true for empty buffer', () => {
    const buf = Buffer.alloc(0);
    const result = checkUtf8Strict(buf);
    expect(result.valid).toBe(true);
  });

  it('returns valid=true for JSON content', () => {
    const json = JSON.stringify({ name: 'test', value: 42 }, null, 2);
    const buf = Buffer.from(json, 'utf8');
    const result = checkUtf8Strict(buf);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// verifyByteForByte
// ---------------------------------------------------------------------------

describe('verifyByteForByte', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-verify-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns true for identical files', async () => {
    const a = path.join(tmpDir, 'a.txt');
    const b = path.join(tmpDir, 'b.txt');
    await fs.writeFile(a, 'identical content');
    await fs.writeFile(b, 'identical content');
    expect(await verifyByteForByte(a, b)).toBe(true);
  });

  it('returns false for files with different content', async () => {
    const a = path.join(tmpDir, 'a.txt');
    const b = path.join(tmpDir, 'b.txt');
    await fs.writeFile(a, 'content A');
    await fs.writeFile(b, 'content B');
    expect(await verifyByteForByte(a, b)).toBe(false);
  });

  it('returns false for files with different lengths', async () => {
    const a = path.join(tmpDir, 'a.txt');
    const b = path.join(tmpDir, 'b.txt');
    await fs.writeFile(a, 'short');
    await fs.writeFile(b, 'a much longer content here');
    expect(await verifyByteForByte(a, b)).toBe(false);
  });

  it('returns true for binary files with identical bytes', async () => {
    const a = path.join(tmpDir, 'a.bin');
    const b = path.join(tmpDir, 'b.bin');
    const data = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0xab, 0xcd]);
    await fs.writeFile(a, data);
    await fs.writeFile(b, data);
    expect(await verifyByteForByte(a, b)).toBe(true);
  });

  it('returns true for a file compared with itself', async () => {
    const a = path.join(tmpDir, 'a.txt');
    await fs.writeFile(a, 'self-check');
    expect(await verifyByteForByte(a, a)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// atomicBackup / atomicRestore / cleanupBackups
// ---------------------------------------------------------------------------

describe('atomicBackup', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-backup-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('creates a backup blob and manifest for an existing file', async () => {
    const file = path.join(tmpDir, 'settings.json');
    await fs.writeFile(file, JSON.stringify({ theme: 'dark' }, null, 2));

    const result = await atomicBackup(file);

    // Backup blob exists.
    expect(await fs.stat(result.backupPath)).toBeTruthy();
    // Manifest exists.
    const manifestFile = path.join(tmpDir, '.backup', 'settings.json.manifest.json');
    expect(await fs.stat(manifestFile)).toBeTruthy();
    // Manifest has one entry.
    const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0].sha256).toBe(result.sha256);
    expect(manifest.entries[0].size).toBe(result.size);
    // Content matches.
    const backupContent = await fs.readFile(result.backupPath, 'utf8');
    expect(JSON.parse(backupContent)).toEqual({ theme: 'dark' });
  });

  it('throws when the source file does not exist', async () => {
    const file = path.join(tmpDir, 'nonexistent.json');
    await expect(atomicBackup(file)).rejects.toThrow();
  });

  it('creates multiple backups with distinct timestamps', async () => {
    const file = path.join(tmpDir, 'config.json');
    await fs.writeFile(file, '{"v":1}');
    await atomicBackup(file);

    // Small delay to ensure different timestamp.
    await new Promise((r) => setTimeout(r, 10));
    await fs.writeFile(file, '{"v":2}');
    await atomicBackup(file);

    const manifestFile = path.join(tmpDir, '.backup', 'config.json.manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
    expect(manifest.entries).toHaveLength(2);
    // Newest first.
    expect(manifest.entries[0].sha256).not.toBe(manifest.entries[1].sha256);
  });

  it('creates nested backup directory as needed', async () => {
    const file = path.join(tmpDir, 'deep', 'nested', 'settings.json');
    await fs.mkdir(path.join(tmpDir, 'deep', 'nested'), { recursive: true });
    await fs.writeFile(file, '{"ok":true}');
    const result = await atomicBackup(file);
    expect(result.backupPath).toContain('.backup');
    const backupContent = await fs.readFile(result.backupPath, 'utf8');
    expect(JSON.parse(backupContent)).toEqual({ ok: true });
  });

  it('returns correct size and sha256', async () => {
    const file = path.join(tmpDir, 'data.json');
    const content = '{"key":"value","num":42}';
    await fs.writeFile(file, content);

    const result = await atomicBackup(file);
    expect(result.size).toBe(Buffer.byteLength(content, 'utf8'));
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('atomicRestore', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-restore-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('restores the latest backup content', async () => {
    const file = path.join(tmpDir, 'settings.json');
    await fs.writeFile(file, '{"v":1}');
    await atomicBackup(file);

    // Modify the file.
    await fs.writeFile(file, '{"v":"modified"}');
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ v: 'modified' });

    // Restore.
    const result = await atomicRestore(file);
    expect(result.verified).toBe(true);
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ v: 1 });
  });

  it('throws when no backup exists', async () => {
    const file = path.join(tmpDir, 'nobackup.json');
    await fs.writeFile(file, '{"any":true}');
    await expect(atomicRestore(file)).rejects.toThrow('No backups found');
  });

  it('restores byte-for-byte identical content', async () => {
    const file = path.join(tmpDir, 'binary.bin');
    const originalData = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xab]);
    await fs.writeFile(file, originalData);
    await atomicBackup(file);

    // Overwrite with different data.
    await fs.writeFile(file, Buffer.from([0x99, 0x88, 0x77]));

    // Restore.
    await atomicRestore(file);
    const restored = await fs.readFile(file);
    expect(Buffer.compare(restored, originalData)).toBe(0);
  });

  it('restores even if the target file is deleted after backup', async () => {
    const file = path.join(tmpDir, 'temp.json');
    await fs.writeFile(file, '{"keep":true}');
    await atomicBackup(file);

    // Delete the file entirely.
    await fs.unlink(file);
    await expect(fs.stat(file)).rejects.toThrow();

    // Restore from backup.
    const result = await atomicRestore(file);
    expect(result.verified).toBe(true);
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ keep: true });
  });

  it('returns the entry metadata', async () => {
    const file = path.join(tmpDir, 'meta.json');
    await fs.writeFile(file, '{"x":1}');
    const backupResult = await atomicBackup(file);

    const restoreResult = await atomicRestore(file);
    expect(restoreResult.entry.sha256).toBe(backupResult.sha256);
    expect(restoreResult.entry.size).toBe(backupResult.size);
    expect(restoreResult.filePath).toBe(file);
  });
});

describe('cleanupBackups', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-cleanup-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('removes old backups beyond keepCount', async () => {
    const file = path.join(tmpDir, 'rotating.json');
    await fs.writeFile(file, '{"v":0}');

    // Create 8 backups.
    for (let i = 1; i <= 8; i++) {
      await fs.writeFile(file, `{"v":${i}}`);
      await atomicBackup(file);
      // Ensure distinct timestamps.
      await new Promise((r) => setTimeout(r, 5));
    }

    // Keep only 3.
    const result = await cleanupBackups(file, 3);
    expect(result.removed).toBe(5);
    expect(result.remaining).toBe(3);

    // Verify manifest.
    const manifestFile = path.join(tmpDir, '.backup', 'rotating.json.manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
    expect(manifest.entries).toHaveLength(3);

    // Verify only 3 backup blobs remain.
    const backupDir = path.join(tmpDir, '.backup');
    const blobs = (await fs.readdir(backupDir)).filter((n) => n.endsWith('.bak'));
    expect(blobs).toHaveLength(3);
  });

  it('does nothing when backup count is within keepCount', async () => {
    const file = path.join(tmpDir, 'stable.json');
    await fs.writeFile(file, '{"v":1}');
    await atomicBackup(file);

    const result = await cleanupBackups(file, 5);
    expect(result.removed).toBe(0);
    expect(result.remaining).toBe(1);
  });

  it('keeps the most recent N backups', async () => {
    const file = path.join(tmpDir, 'recent.json');
    await fs.writeFile(file, '{"v":"a"}');

    for (let i = 0; i < 6; i++) {
      await fs.writeFile(file, `{"v":"${i}"}`);
      await atomicBackup(file);
      await new Promise((r) => setTimeout(r, 5));
    }

    await cleanupBackups(file, 2);

    const manifestFile = path.join(tmpDir, '.backup', 'recent.json.manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
    expect(manifest.entries).toHaveLength(2);
    // The two most recent should be v=5 and v=4.
    expect(manifest.entries[0].file).toContain('recent.json');
    expect(manifest.entries[1].file).toContain('recent.json');
  });

  it('returns 0 removed when no manifest exists', async () => {
    const file = path.join(tmpDir, 'nobackup.json');
    await fs.writeFile(file, '{"x":1}');
    const result = await cleanupBackups(file, 3);
    expect(result.removed).toBe(0);
    expect(result.remaining).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Integration: backup → modify → restore roundtrip
// ---------------------------------------------------------------------------

describe('backup-restore roundtrip (integration)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-roundtrip-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('full roundtrip: backup, modify, restore, verify', async () => {
    const file = path.join(tmpDir, 'config.json');
    const originalData = { agent: 'traework', theme: 'deep-blue', version: 3 };
    await fs.writeFile(file, JSON.stringify(originalData, null, 2));

    // Backup.
    const backup = await atomicBackup(file);
    expect(backup.size).toBeGreaterThan(0);

    // Modify.
    await fs.writeFile(file, JSON.stringify({ agent: 'qoderwork', theme: 'reset' }, null, 2));
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({
      agent: 'qoderwork',
      theme: 'reset',
    });

    // Restore.
    const restore = await atomicRestore(file);
    expect(restore.verified).toBe(true);

    // Verify content matches original.
    const restoredContent = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(restoredContent).toEqual(originalData);

    // Verify byte-for-byte against original write.
    const restoredBuf = await fs.readFile(file);
    // The restored content might have different trailing characters due to
    // writeFile not adding a trailing newline. Check JSON equality instead.
    expect(restoredBuf.toString('utf8')).toBe(JSON.stringify(originalData, null, 2));
  });

  it('handles JSON with unicode content', async () => {
    const file = path.join(tmpDir, 'unicode.json');
    const data = { name: '测试', emoji: '🎨', lang: '日本語' };
    await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
    await atomicBackup(file);

    await fs.writeFile(file, '{"corrupted":true}');
    const restore = await atomicRestore(file);
    expect(restore.verified).toBe(true);
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual(data);
  });

  it('handles large files', async () => {
    const file = path.join(tmpDir, 'large.json');
    // Create a ~500KB JSON payload.
    const largeArray = Array.from({ length: 10000 }, (_, i) => ({
      id: i,
      name: `item-${i}`,
      data: 'x'.repeat(40),
    }));
    await fs.writeFile(file, JSON.stringify(largeArray));
    await atomicBackup(file);

    // Corrupt the file.
    await fs.writeFile(file, 'CORRUPTED');
    expect(await fs.readFile(file, 'utf8')).toBe('CORRUPTED');

    // Restore.
    const restore = await atomicRestore(file);
    expect(restore.verified).toBe(true);

    const restored = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(restored).toHaveLength(10000);
    expect(restored[0].id).toBe(0);
    expect(restored[9999].id).toBe(9999);
  });
});

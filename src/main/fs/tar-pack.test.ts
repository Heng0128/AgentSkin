// SPDX-License-Identifier: MPL-2.0

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractTarGz, packDirToTarGz } from './tar-pack';

describe('tar-pack — 往返一致性', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tar-pack-test-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function writeFixture(): Promise<string> {
    const src = path.join(root, 'src');
    await fs.mkdir(path.join(src, 'sub'), { recursive: true });
    await fs.writeFile(path.join(src, 'manifest.json'), JSON.stringify({ id: 'x' }));
    await fs.writeFile(path.join(src, 'sub', 'a.css'), ':root { --x: 1; }');
    // 二进制（含 0 字节）与较大文件。
    await fs.writeFile(path.join(src, 'sub', 'video.bin'), Buffer.from([0, 1, 2, 255, 0, 128]));
    await fs.writeFile(path.join(src, 'big.bin'), Buffer.alloc(4096, 7));
    return src;
  }

  it('packs and extracts a directory tree byte-for-byte', async () => {
    const src = await writeFixture();
    const archive = path.join(root, 'out.bundle');
    await packDirToTarGz(src, archive);

    const out = path.join(root, 'out');
    await extractTarGz(archive, out);

    const readAll = async (dir: string): Promise<Map<string, Buffer>> => {
      const map = new Map<string, Buffer>();
      const walk = async (current: string, rel: string): Promise<void> => {
        const names = await fs.readdir(current, { withFileTypes: true });
        for (const entry of names) {
          const childRel = rel ? `${rel}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            await walk(path.join(current, entry.name), childRel);
          } else {
            map.set(childRel, await fs.readFile(path.join(current, entry.name)));
          }
        }
      };
      await walk(dir, '');
      return map;
    };

    const expected = await readAll(src);
    const actual = await readAll(out);
    expect(actual.size).toBe(expected.size);
    for (const [rel, buf] of expected) {
      expect(actual.has(rel), `missing ${rel}`).toBe(true);
      expect(Buffer.compare(actual.get(rel)!, buf)).toBe(0);
    }
  });

  it('extracts a bundle whose files live at the archive root', async () => {
    const src = await writeFixture();
    const archive = path.join(root, 'b2.bundle');
    await packDirToTarGz(src, archive);
    const out = path.join(root, 'out2');
    await extractTarGz(archive, out);
    expect((await fs.stat(path.join(out, 'sub', 'a.css'))).isFile()).toBe(true);
  });
});

describe('tar-pack — 解包安全', () => {
  it('rejects entries that escape the target root', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tar-pack-evil-'));
    try {
      // 手工构造一个含 ../ 路径的 tar：直接复用 pack 一个"合法"目录，
      // 再手工拼一个恶意条目（evil tar）。
      const evilEntry = Buffer.alloc(512);
      // 手工写一个头部：name='../../pwned', type '0', size 4
      evilEntry.fill(0);
      Buffer.from('../../pwned', 'utf8').copy(evilEntry, 0);
      evilEntry[156] = 0x30; // '0'
      Buffer.from('4', 'utf8').copy(evilEntry, 124);
      evilEntry[156 + 0] = 0;
      evilEntry[257] = 0;
      // checksum 合法化
      evilEntry.fill(0x20, 148, 156);
      const sum = evilEntry.reduce((a, b) => a + b, 0);
      Buffer.from(sum.toString(8).padStart(6, '0') + '\0 ', 'utf8').copy(evilEntry, 148);
      const data = Buffer.from('EVIL', 'utf8');
      const tar = Buffer.concat([evilEntry, data, Buffer.alloc(508), Buffer.alloc(1024)]);
      const { gzipSync } = await import('node:zlib');
      const evilFile = path.join(root, 'evil.bundle');
      await fs.writeFile(evilFile, gzipSync(tar));

      await expect(extractTarGz(evilFile, path.join(root, 'out'))).rejects.toThrow(/escapes/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

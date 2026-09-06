// SPDX-License-Identifier: MPL-2.0

/**
 * # tar-pack — 零依赖 tar.gz 打包/解包（.agentskin-bundle 容器）
 *
 * AgentSkin 需要一种"目录 → 单文件容器"的格式用于组合包（Theme +
 * Wallpaper 视频），但项目零运行时依赖、无 zip 库。tar + gzip 是纯 Node
 * 标准库（`node:zlib`）即可实现的最小可行容器：
 *
 *   - pack：递归目录 → ustar tar 流（512B 头 + 数据对齐 + 双零块尾）→ gzip。
 *   - extract：gunzip → 解析条目 → 逐文件写出，所有路径 resolveWithin 目标根
 *     拒绝路径穿越（`../`、绝对路径）。
 *
 * 视频等大文件以 stored 方式进 tar（tar 本身不压缩内容，gzip 对视频几乎无
 * 收益且慢——故 .agentskin-bundle 内是 tar.gz，视频实际等于原样存储）。
 *
 * 仅实现本项目所需的 ustar 子集：regular 文件（typeflag '0'）与目录（'5'）。
 * 文件名 >100 字符时走 ustar prefix 字段（name 存尾 100、prefix 存前段）。
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

const BLOCK = 512;
const NAME_MAX = 100;
const PREFIX_MAX = 155;

/** tar 头部字段的写入 helper（固定宽度、NUL 填充）。 */
function headerField(buf: Buffer, offset: number, len: number, value: string): void {
  const bytes = Buffer.from(value, 'utf8');
  buf.fill(0, offset, offset + len);
  bytes.copy(buf, offset, 0, Math.min(bytes.length, len));
}

/** 计算 tar 头 checksum（前 148 字节求和，checksum 字段本身填空格）。 */
function headerChecksum(buf: Buffer): number {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += buf[i];
  return sum;
}

/** 把相对路径拆成 ustar 的 name（≤100）与 prefix（≤155，可空）。 */
function splitName(rel: string): { name: string; prefix: string } {
  if (rel.length <= NAME_MAX) return { name: rel, prefix: '' };
  // 从后往前找 '/'，使 name 部分 ≤100。
  const cut = rel.length - NAME_MAX;
  const idx = rel.indexOf('/', cut);
  if (idx === -1 || idx > PREFIX_MAX) {
    // 无法拆（单段超长或前缀超长）——尽力截断，打包侧可接受。
    return { name: rel.slice(0, NAME_MAX), prefix: '' };
  }
  return { name: rel.slice(idx + 1), prefix: rel.slice(0, idx) };
}

/** 单条目 tar 头（512B）。size 是数据字节数。 */
function buildHeader(rel: string, typeflag: '0' | '5', size: number): Buffer {
  const { name, prefix } = splitName(rel);
  const buf = Buffer.alloc(BLOCK, 0);
  headerField(buf, 0, NAME_MAX, name);
  // mode: 0644（文件）/ 0755（目录）
  headerField(buf, 100, 8, typeflag === '5' ? '755' : '644');
  headerField(buf, 108, 8, '0'); // uid
  headerField(buf, 116, 8, '0'); // gid
  headerField(buf, 124, 12, size.toString(8)); // size（八进制）
  headerField(buf, 136, 12, '0'); // mtime
  buf[156] = typeflag.charCodeAt(0);
  // magic "ustar" + version "00"
  headerField(buf, 257, 6, 'ustar');
  headerField(buf, 263, 2, '00');
  // checksum: 填 8 个空格后计算
  headerField(buf, 148, 8, '        ');
  headerField(buf, 148, 6, headerChecksum(buf).toString(8).padStart(6, '0'));
  buf[154] = 0;
  buf[155] = 0x20;
  if (prefix) headerField(buf, 345, PREFIX_MAX, prefix);
  return buf;
}

/** 递归收集目录下所有相对路径（目录在前，保证解包时父目录先建）。 */
async function collectEntries(dir: string): Promise<Array<{ rel: string; isDir: boolean }>> {
  const entries: Array<{ rel: string; isDir: boolean }> = [];
  const walk = async (current: string, rel: string): Promise<void> => {
    const names = await fs.readdir(current, { withFileTypes: true });
    names.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of names) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        entries.push({ rel: childRel, isDir: true });
        await walk(path.join(current, entry.name), childRel);
      } else if (entry.isFile()) {
        entries.push({ rel: childRel, isDir: false });
      }
      // symlink/其他类型跳过（主题包内不涉及）。
    }
  };
  // 根目录自身不写条目（解包目标是已存在的 outDir）。
  await walk(dir, '');
  return entries;
}

/** 把目录打包为 tar.gz 单文件。 */
export async function packDirToTarGz(dir: string, outFile: string): Promise<void> {
  const entries = await collectEntries(dir);
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const abs = path.join(dir, entry.rel);
    const data = entry.isDir ? Buffer.alloc(0) : await fs.readFile(abs);
    const header = buildHeader(entry.rel, entry.isDir ? '5' : '0', data.length);
    blocks.push(header);
    if (data.length > 0) blocks.push(data);
    const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
    if (pad > 0) blocks.push(Buffer.alloc(pad, 0));
  }
  // 双零块尾。
  blocks.push(Buffer.alloc(BLOCK * 2, 0));
  const tar = Buffer.concat(blocks);
  const gz = gzipSync(tar);
  await fs.writeFile(outFile, gz);
}

export interface TarEntry {
  /** 条目相对路径（已归一化为正斜杠）。 */
  name: string;
  isDir: boolean;
  size: number;
  /** 数据在解压后 tar 缓冲中的字节偏移（isDir 时为 0）。 */
  dataOffset: number;
}

/** 解析 tar 二进制为条目列表（不落地）。非法头部抛错。 */
export function parseTar(tar: Buffer): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  for (;;) {
    const header = tar.subarray(offset, offset + BLOCK);
    // 全零块 = 结束。
    if (header.length === 0 || header.every((b) => b === 0)) break;
    if (header.length < BLOCK) throw new Error('tar: truncated header');
    // 校验 checksum。
    const stored = parseInt(header.subarray(148, 156).toString('utf8').trim(), 8);
    const saved = Buffer.from(header);
    header.fill(0x20, 148, 156);
    const sum = headerChecksum(Buffer.from(header));
    if (stored !== sum) throw new Error('tar: checksum mismatch');
    const typeflag = String.fromCharCode(saved[156] ?? 0);
    let name = saved.subarray(0, NAME_MAX).toString('utf8').replace(/\0+$/, '');
    const prefix = saved
      .subarray(345, 345 + PREFIX_MAX)
      .toString('utf8')
      .replace(/\0+$/, '');
    if (prefix) name = `${prefix}/${name}`;
    const size = parseInt(saved.subarray(124, 136).toString('utf8').trim(), 8) || 0;
    const isDir = typeflag === '5';
    const dataOffset = offset + BLOCK;
    if (!isDir && typeflag !== '0' && typeflag !== '\0') {
      throw new Error(`tar: unsupported entry type "${typeflag}"`);
    }
    entries.push({ name, isDir, size, dataOffset });
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }
  return entries;
}

/** 解包 tar.gz 到目标目录。所有条目路径 resolveWithin 目标根，拒绝穿越。 */
export async function extractTarGz(file: string, outDir: string): Promise<void> {
  const gz = await fs.readFile(file);
  const tar = gunzipSync(gz);
  const root = path.resolve(outDir);
  await fs.mkdir(root, { recursive: true });
  for (const entry of parseTar(tar)) {
    const resolved = path.resolve(path.join(root, entry.name));
    if (!resolved.startsWith(root)) {
      throw new Error(`bundle: path escapes target root: ${entry.name}`);
    }
    if (entry.isDir) {
      await fs.mkdir(resolved, { recursive: true });
      continue;
    }
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    const data = tar.subarray(entry.dataOffset, entry.dataOffset + entry.size);
    await fs.writeFile(resolved, data);
  }
}

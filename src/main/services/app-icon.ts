// SPDX-License-Identifier: MPL-2.0

/**
 * # App Icon Extraction
 *
 * Resolves a real application icon and returns it as a `data:` URL so it can
 * cross the IPC boundary and be rendered directly in an `<img>`.
 *
 * Order matters. VS Code forks (CodeBuddy CN, Trae, 小云雀 …) and Electron
 * apps that store their icon as **PNG inside the PE `RT_ICON` resource**
 * cannot be read by `app.getFileIcon` / `SHGetFileInfo` — those APIs fall
 * back to a generic default (non-empty), so probing emptiness isn't enough to
 * trigger a PNG fallback. We probe the PE `.rsrc` section first and use the
 * embedded PNG whenever it's a sensible app-icon shape (square 16–1024 px);
 * otherwise we hand off to the OS shell icon for standard ICO apps.
 *
 *   1. PNG inside `resources/app(.asar)` style PE resource (square 64+ px).
 *      Probes only the `.rsrc` section — fast even for 200 MB Electron exes.
 *   2. The exe's embedded PE icon via `app.getFileIcon` (OS icon cache).
 *   3. A standalone `.ico` next to the exe.
 *
 * Only valid after `app` is ready — always the case inside an IPC handler.
 * Callers degrade gracefully: `null` means "use the letter placeholder".
 */

import fs, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { app, nativeImage } from 'electron';

/** PNG magic bytes (8-byte signature). */
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Sanity cap on the .rsrc section we accept (16 MB). */
const RSRC_CAP = 16 * 1024 * 1024;

/**
 * Read only the `.rsrc` PE section of `exePath`. PE resources (including
 * `RT_ICON`, `RT_GROUP_ICON`, `RT_VERSION`, manifest, …) live in this section,
 * which is typically a few hundred KB — far cheaper than pulling the full
 * multi-hundred-MB Electron exe into memory.
 */
async function readRsrcSection(exePath: string): Promise<Buffer | null> {
  let fd: FileHandle | null = null;
  try {
    fd = await fs.open(exePath, 'r');
    // DOS header: `e_lfanew` lives at offset 0x3C.
    const dos = Buffer.alloc(0x40);
    await fd.read(dos, 0, 0x40, 0);
    const e_lfanew = dos.readUInt32LE(0x3c);

    // PE signature (4) + COFF header (20) = 24 bytes. All fields little-endian.
    const peHead = Buffer.alloc(24);
    await fd.read(peHead, 0, 24, e_lfanew);
    const numSections = peHead.readUInt16LE(6);
    const optSize = peHead.readUInt16LE(20);
    const sectionOff = e_lfanew + 24 + optSize;

    // Section table: 40 bytes per entry.
    const sec = Buffer.alloc(40);
    for (let i = 0; i < numSections; i++) {
      await fd.read(sec, 0, 40, sectionOff + i * 40);
      const name = sec.toString('utf8', 0, 8).replace(/\0/g, '');
      if (name === '.rsrc') {
        const rawSize = sec.readUInt32LE(16); // SizeOfRawData
        const rawOff = sec.readUInt32LE(20); // PointerToRawData
        if (rawSize <= 0 || rawSize > RSRC_CAP) return null;
        const buf = Buffer.alloc(rawSize);
        await fd.read(buf, 0, rawSize, rawOff);
        return buf;
      }
    }
  } catch {
    // exe unreadable — fall through.
  } finally {
    if (fd) await fd.close();
  }
  return null;
}

/** Find the largest square PNG (64–1024 px on each side) inside `buf`. */
function largestSquarePng(buf: Buffer): Buffer | null {
  let best: { area: number; data: Buffer } | null = null;
  let idx = 0;
  while (idx <= buf.length - 8) {
    const sig = buf.indexOf(PNG_SIG, idx);
    if (sig < 0) break;
    // IHDR width/height at sig + 16 (8 sig + 4 len + 4 'IHDR'), big-endian.
    const ihdr = sig + 16;
    if (ihdr + 8 > buf.length) break;
    const w = buf.readUInt32BE(ihdr);
    const h = buf.readUInt32BE(ihdr + 4);
    if (w === h && w >= 64 && w <= 1024) {
      // Capture the full PNG chunk stream: signature → IEND chunk end.
      const iend = buf.indexOf('IEND', ihdr);
      if (iend > sig) {
        const area = w * h;
        if (!best || area > best.area) {
          best = { area, data: Buffer.from(buf.subarray(sig, iend + 8)) };
        }
      }
    }
    idx = sig + 8;
  }
  return best?.data ?? null;
}

/**
 * Extract an app icon as a `data:` URL, or `null` on any failure.
 *
 * @param exePath Absolute path to the executable.
 */
export async function extractAppIcon(exePath: string): Promise<string | null> {
  // 1. Embedded PNG inside .rsrc (VS Code forks / Electron apps with PNG icons).
  //    Probing first is critical: getFileIcon falls back to a non-empty generic
  //    icon for these exes, so emptiness can't be used to trigger PNG fallback.
  try {
    const rsrc = await readRsrcSection(exePath);
    if (rsrc) {
      const png = largestSquarePng(rsrc);
      if (png) {
        const img = nativeImage.createFromBuffer(png);
        if (!img.isEmpty()) return img.toDataURL();
      }
    }
  } catch {
    // fall through to the next fallback.
  }

  // 2. Standard ICO/DIB icon via the OS shell (GetFileIcon / SHGetFileInfo).
  try {
    const icon = await app.getFileIcon(exePath, { size: 'large' });
    if (!icon.isEmpty()) return icon.toDataURL();
  } catch {
    // fall through.
  }

  // 3. Standalone .ico next to the exe.
  try {
    const dir = path.dirname(exePath);
    const entries = await fs.readdir(dir);
    const ico = entries.find((e) => e.toLowerCase().endsWith('.ico'));
    if (ico) {
      const icon = await app.getFileIcon(path.join(dir, ico), { size: 'large' });
      if (!icon.isEmpty()) return icon.toDataURL();
    }
  } catch {
    // No directory or no .ico — degrade to the letter placeholder.
  }

  return null;
}

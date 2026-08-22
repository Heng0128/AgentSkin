// SPDX-License-Identifier: MPL-2.0

// 我的调色板预设库 —— 纯前端 localStorage 持久化，不依赖任何 IPC/主进程。
// 仅保存/读取 ToolOverride.colors（完整的 14 键语义调色板）即可完整还原。

const STORAGE_KEY = 'agentskin.palettePresets.v1';

export interface PalettePreset {
  id: string;
  name: string;
  colors: Record<string, string>;
  createdAt: number;
}

function genId(): string {
  // 优先 crypto.randomUUID()，否则用 Date.now + 随机串兜底（兼容隐私模式/旧运行时）
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // 忽略，走兜底
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function readRaw(): PalettePreset[] {
  // 容错：localStorage 不可用 / JSON 损坏 / 结构异常 时一律返回 []，不抛错。
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (p): p is PalettePreset =>
          p != null &&
          typeof p.id === 'string' &&
          typeof p.name === 'string' &&
          typeof p.colors === 'object' &&
          p.colors !== null,
      )
      .map((p) => ({
        id: p.id,
        name: p.name,
        colors: p.colors as Record<string, string>,
        createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now(),
      }));
  } catch {
    return [];
  }
}

function writeRaw(presets: PalettePreset[]): void {
  // 隐私模式 / 配额超限 时不抛出，丢失也在可接受范围（纯前端本地库）。
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // 忽略写入失败
  }
}

/** 读取全部已保存的调色板预设（按创建时间倒序，最新在前）。 */
export function loadPalettePresets(): PalettePreset[] {
  return readRaw().sort((a, b) => b.createdAt - a.createdAt);
}

/** 把当前调色板保存为命名预设（追加并写回）。 */
export function savePalettePreset(name: string, colors: Record<string, string>): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  const presets = readRaw();
  presets.push({
    id: genId(),
    name: trimmed,
    colors: { ...colors },
    createdAt: Date.now(),
  });
  writeRaw(presets);
}

/** 按 id 删除一条预设。 */
export function deletePalettePreset(id: string): void {
  const next = readRaw().filter((p) => p.id !== id);
  writeRaw(next);
}

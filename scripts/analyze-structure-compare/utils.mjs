// SPDX-License-Identifier: MPL-2.0

/**
 * # 结构对拍 — 工具函数
 */

import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** 全局运行选项（由 main 解析 CLI 参数写入） */
export const OPTIONS = {
  debug: false,
  markdown: false,
  ci: false,
  skipCefSubapp: false,
  ignorePath: null,
  suggestIgnore: false,
  rules: false,
  meta: false,
  writePatches: false,
  dryRun: false,
  shadowSeed: { common: [], byAgent: {} },
};

export function debugLog(...parts) {
  if (OPTIONS.debug) console.log('[debug]', ...parts);
}

/** 安全执行外部命令，失败时返回空字符串而非抛出。 */
export const execFileSafe = async (cmd, args) => {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: 8000 });
    return stdout;
  } catch {
    return '';
  }
};

/** 二进制嗅探：读取内容含 NUL 或不可打印控制字符占比过高时判定为非文本资源，跳过。 */
export function looksBinary(chunk) {
  const sample = chunk.subarray ? chunk.subarray(0, 2048) : String(chunk).slice(0, 2048);
  let nul = 0;
  for (const byte of sample) if (byte === 0 || byte === '\0') nul++;
  if (nul > 0) return true;
  const text = typeof sample === 'string' ? sample : sample.toString('latin1');
  let ctrl = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 9 || (code > 13 && code < 32)) ctrl++;
  }
  return text.length > 0 && ctrl / text.length > 0.02;
}

/**
 * 黑白名单配置加载：--ignore 指向的 JSON 文件（{ classTokens: [], cssVars: [] }）。
 * 用于过滤固定 CSS Modules 噪声类名 / 变量，减少无效 diff。文件缺失或解析失败时静默降级为空名单。
 */
export function loadIgnoreList(path) {
  const empty = { classTokens: new Set(), cssVars: new Set() };
  if (!path) return empty;
  if (!existsSync(path)) {
    debugLog(`ignore 配置文件不存在，忽略: ${path}`);
    return empty;
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8'));
    return {
      classTokens: new Set(Array.isArray(raw.classTokens) ? raw.classTokens : []),
      cssVars: new Set(Array.isArray(raw.cssVars) ? raw.cssVars : []),
    };
  } catch (e) {
    debugLog(`ignore 配置解析失败（已忽略）: ${e.message}`);
    return empty;
  }
}

/**
 * 加载 --shadow-seed 指向的种子增量文件（{ "agentId": ["selector", ...], "common": [...] }），
 * 用于注入已人工验证的 closed shadow 选择器。文件缺失/解析失败时静默降级为空。
 */
export function loadShadowSeed(path) {
  const empty = { common: [], byAgent: {} };
  if (!path || !existsSync(path)) return empty;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8'));
    const byAgent = {};
    for (const k of Object.keys(raw)) {
      if (k === 'common') {
        (Array.isArray(raw.common) ? raw.common : []).forEach((s) => {
          if (typeof s === 'string' && !empty.common.includes(s)) empty.common.push(s);
        });
      } else if (typeof raw[k] === 'string') {
        byAgent[k] = [raw[k]];
      } else if (Array.isArray(raw[k])) {
        byAgent[k] = raw[k].filter((s) => typeof s === 'string');
      }
    }
    return { common: empty.common, byAgent };
  } catch (e) {
    debugLog(`shadow-seed 解析失败（已忽略）: ${e.message}`);
    return empty;
  }
}

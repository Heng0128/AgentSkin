// SPDX-License-Identifier: MPL-2.0

/**
 * # 结构对拍 — 静态解包探测
 *
 * 通过 @electron/asar 只读解包 app.asar，提取 renderer bundle 中的类名字面量、
 * CSS 文件中的自定义属性声明。
 */

import { dirname, join } from 'node:path';
import asar from '@electron/asar';
import { discoverApp } from '../../src/engine/src/runtime/launcher.mjs';
import { STATIC_BYTES_PER_FILE, STATIC_CSS_BYTES_TOTAL, STATIC_JS_FILE_CAP } from './constants.mjs';
import { debugLog, looksBinary } from './utils.mjs';

/** 定位 app.asar 文件。 */
function locateAsar(appPath, executable) {
  const dirs = [appPath, executable ? dirname(executable) : null].filter(Boolean);
  const candidates = [
    join(appPath, 'resources', 'app.asar'),
    join(appPath, 'app.asar'),
    join(appPath, 'resources', 'app.asar.unpacked'),
  ];
  for (const dir of dirs) {
    candidates.push(join(dir, 'resources', 'app.asar'));
    candidates.push(join(dir, 'app.asar'));
  }
  for (const candidate of [...new Set(candidates)]) {
    // asar 头部校验：前 8 字节必须为 asar 魔数
    if (asarHeaderValid(candidate)) return candidate;
  }
  return null;
}

/** 校验 asar 文件头部魔数（只读前 8 字节，不加载整个文件）。 */
function asarHeaderValid(path) {
  try {
    const fd = asar.openFile(path);
    const header = asar.readHeader(fd);
    asar.closeFile(fd);
    return !!header;
  } catch {
    return false;
  }
}

/** 从 JS 文件中提取类名字面量（简单正则，不解析 AST）。 */
function extractClassTokensFromJs(content) {
  const tokens = new Set();
  // 匹配 className="..." 或 className={'...'} 模式
  const re = /className\s*=\s*["'`]([^"'`]+)["'`]/g;
  let m = re.exec(content);
  while (m !== null) {
    for (const cls of m[1].split(/\s+/)) if (cls) tokens.add(cls);
    m = re.exec(content);
  }
  return tokens;
}

/** 从 CSS 文件中提取 :root 变量声明。 */
function extractCssVarsFromCss(content) {
  const vars = new Set();
  const re = /--([A-Za-z0-9_-]+)\s*:/g;
  let m = re.exec(content);
  while (m !== null) {
    if (!m[1].startsWith('agentskin-')) vars.add(`--${m[1]}`);
    m = re.exec(content);
  }
  return vars;
}

/**
 * 探测单个 Agent 的静态结构。
 * 返回 { ok, asarPath, layout, scanned, classTokens, cssVars }。
 */
export async function probeStatic(adapter) {
  const appInfo = await discoverApp(adapter, process.platform);
  if (!appInfo?.appPath) {
    return { ok: false, error: '无法定位应用安装路径' };
  }
  const asarPath = locateAsar(appInfo.appPath, appInfo.executable);
  if (!asarPath) {
    return { ok: false, error: '无法定位 app.asar 文件' };
  }
  try {
    const header = asar.listPackage(asarPath, { computeFiles: true });
    if (!header?.files) {
      return { ok: false, error: 'asar 包为空或格式异常' };
    }
    // 收集 JS / CSS 文件
    const jsFiles = [];
    const cssFiles = [];
    for (const file of Object.keys(header.files)) {
      if (file.startsWith('.')) continue;
      const lower = file.toLowerCase();
      if (lower.endsWith('.js') && !lower.includes('node_modules')) {
        jsFiles.push(file);
      } else if (lower.endsWith('.css')) {
        cssFiles.push(file);
      }
    }
    // 限制扫描数量
    const jsToScan = jsFiles.slice(0, STATIC_JS_FILE_CAP);
    const cssToScan = cssFiles;
    const classTokens = new Set();
    const cssVars = new Set();
    let jsBytes = 0;
    let cssBytes = 0;
    // 扫描 JS 文件
    for (const file of jsToScan) {
      try {
        const content = asar.extractFile(asarPath, file);
        if (looksBinary(content)) continue;
        const text = content.toString('utf-8');
        jsBytes += text.length;
        if (jsBytes > STATIC_BYTES_PER_FILE * STATIC_JS_FILE_CAP) break;
        for (const token of extractClassTokensFromJs(text)) classTokens.add(token);
      } catch (e) {
        debugLog(`JS 文件提取失败: ${file} (${e.message})`);
      }
    }
    // 扫描 CSS 文件
    for (const file of cssToScan) {
      try {
        const content = asar.extractFile(asarPath, file);
        if (looksBinary(content)) continue;
        const text = content.toString('utf-8');
        cssBytes += text.length;
        if (cssBytes > STATIC_CSS_BYTES_TOTAL) break;
        for (const v of extractCssVarsFromCss(text)) cssVars.add(v);
      } catch (e) {
        debugLog(`CSS 文件提取失败: ${file} (${e.message})`);
      }
    }
    return {
      ok: true,
      asarPath,
      layout: asarPath.includes('unpacked') ? 'unpacked' : 'asar',
      scanned: { jsFiles: jsToScan.length, cssFiles: cssToScan.length, jsBytes, cssBytes },
      classTokens: { unique: classTokens.size, tokens: [...classTokens].slice(0, 5000) },
      cssVars: { unique: cssVars.size, names: [...cssVars].slice(0, 2000) },
    };
  } catch (e) {
    return { ok: false, error: `asar 解包异常: ${e.message}` };
  }
}

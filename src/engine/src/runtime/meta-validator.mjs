// SPDX-License-Identifier: MPL-2.0

/**
 * Layer4 元模型自校验探针（纯函数，无 CDP/DOM 副作用，可单测）
 *
 * 校验 Layer3 推理出的 agent-theme-meta 是否与真实实例吻合——发现"元模型本身错了"的情况，
 * 避免错误的元模型驱动后续全部注入决策。
 *
 * 校验项（全部只读）：
 *   1. currentNativeMode → 抽样 landmark 节点 computed 背景/文字色，验证 dark/light 特征
 *   2. canSilentSwitch=true → 校验 globalApi 函数确实存在、store 路径可读
 *   3. adoptedStyleSheetDetected=true → 校验运行时确实采集到构造样式表
 *
 * 结果：pass（可信）/ warn（存疑，提升注入后采样密度）/ fail（强制 confidence=low，禁止静默切换）
 */

/** 颜色字符串 → 感知亮度 0-255（支持 rgb/rgba/#hex），无法解析返回 null。 */
export function colorLuminance(colorStr) {
  if (!colorStr) return null;
  const s = String(colorStr);
  const m = s.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\)/);
  if (m) {
    const r = Number(m[1]);
    const g = Number(m[2]);
    const b = Number(m[3]);
    const a = m[4] !== undefined ? Number(m[4]) : 1;
    if (a === 0) return null; // 全透明背景：无背景证据，跳过而非误判为暗色
    return (r * 299 + g * 587 + b * 114) / 1000;
  }
  const hex = s.replace('#', '');
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000;
  }
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    return (r * 299 + g * 587 + b * 114) / 1000;
  }
  return null;
}

/**
 * 从 landmark computed 采样推断模式：亮底暗字→light，暗底亮字→dark，冲突→unknown。
 * @param {Array<{selector?: string, backgroundColor: string, color: string}>} samples
 */
export function inferModeFromLandmarkColors(samples) {
  if (!Array.isArray(samples) || samples.length === 0) return 'unknown';
  let bgScore = 0;
  let bgCount = 0;
  let txtScore = 0;
  let txtCount = 0;
  for (const s of samples) {
    const bg = colorLuminance(s?.backgroundColor);
    const txt = colorLuminance(s?.color);
    if (bg != null) {
      bgCount += 1;
      bgScore += bg >= 128 ? 1 : 0; // 亮背景 → light 证据
    }
    if (txt != null) {
      txtCount += 1;
      txtScore += txt >= 128 ? 1 : 0; // 亮文字 → dark 证据
    }
  }
  if (bgCount === 0 && txtCount === 0) return 'unknown';
  const bgMode = bgCount ? (bgScore / bgCount > 0.5 ? 'light' : 'dark') : null;
  const txtMode = txtCount ? (txtScore / txtCount > 0.5 ? 'dark' : 'light') : null;
  if (bgMode && txtMode && bgMode !== txtMode) return 'unknown'; // 背景与文字信号冲突
  return bgMode ?? txtMode ?? 'unknown';
}

/**
 * 校验元模型。@param meta 为 inferMeta 的输出；@param runtimeProbe 含 styleAst/domContext/landmarkColors/globalApiCheck。
 * @returns {{status:'pass'|'warn'|'fail', summary:string, checks:Array}}
 */
export function validateMeta(meta, runtimeProbe) {
  const checks = [];
  const styleAst = runtimeProbe?.styleAst;
  const landmarkColors = runtimeProbe?.landmarkColors;

  // 1. currentNativeMode ↔ landmark computed 采样
  if (meta?.currentNativeMode === 'dark' || meta?.currentNativeMode === 'light') {
    if (Array.isArray(landmarkColors) && landmarkColors.length > 0) {
      const actual = inferModeFromLandmarkColors(landmarkColors);
      checks.push({
        check: 'currentNativeMode',
        meta: meta.currentNativeMode,
        actual,
        pass: actual === meta.currentNativeMode,
        samples: landmarkColors.slice(0, 3),
      });
    } else {
      checks.push({ check: 'currentNativeMode', meta: meta.currentNativeMode, actual: null, pass: null, note: '无 landmark 采样数据，无法校验' });
    }
  }

  // 2. canSilentSwitch ↔ globalApi 存在性（需运行时探测 globalApiCheck；rule 未开启时跳过）
  if (meta?.canSilentSwitch === true) {
    const api = runtimeProbe?.globalApiCheck;
    if (api) {
      checks.push({ check: 'canSilentSwitch', meta: true, actual: api.available, pass: api.available === true, detail: api });
    } else {
      checks.push({ check: 'canSilentSwitch', meta: true, actual: null, pass: null, note: '无 globalApi 探测数据' });
    }
  }

  // 3. adoptedStyleSheetDetected ↔ 运行时确实采集到构造样式表
  if (meta?.adoptedStyleSheetDetected === true) {
    const actual = !!(styleAst && !styleAst.error && styleAst.adoptedSheets > 0);
    checks.push({ check: 'adoptedStyleSheetDetected', meta: true, actual, pass: actual });
  }

  const failed = checks.filter((c) => c.pass === false);
  const warned = checks.filter((c) => c.pass === null || c.pass === undefined);
  const status = failed.length > 0 ? 'fail' : warned.length > 0 ? 'warn' : 'pass';
  const summary =
    status === 'fail'
      ? `元模型校验失败 ${failed.length} 项：${failed.map((c) => c.check).join(', ')}，强制 confidence=low、禁止静默切换`
      : status === 'warn'
        ? `部分字段存疑（${warned.map((c) => c.check).join(', ')}），提升后续注入校验采样密度`
        : '元模型可信';

  return { status, summary, checks };
}
